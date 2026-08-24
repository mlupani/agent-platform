import { Body, Controller, Post, Res, UseGuards, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AgentService } from '../ai/agents/agent.service';
import { BusinessesService } from '../businesses/businesses.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const chatSchema = z.object({
  /** Opcional: si falta, usa el negocio del deployment (single-business). */
  businessId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
  channel: z.string().optional(),
  userId: z.string().uuid().optional(),
  agentConfigId: z.string().uuid().optional(),
  debug: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

@Controller('chat')
@UseGuards(ApiKeyGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly agent: AgentService,
    private readonly businesses: BusinessesService,
  ) {}

  @Post('messages')
  async send(
    @Body(new ZodValidationPipe(chatSchema))
    body: z.infer<typeof chatSchema>,
  ) {
    this.logger.log(`[REQUEST RECEIVED] ${new Date().toISOString()} POST /chat/messages channel=${body.channel ?? 'WEB'} debug=${Boolean(body.debug)}`);
    const start = Date.now();
    const businessId =
      body.businessId ?? (await this.businesses.getCurrentId());
    this.logger.log(`[BUSINESS RESOLVED] ${Date.now() - start}ms businessId=${businessId}`);
    const agentStart = Date.now();
    const result = await this.agent.run({
      ...body,
      businessId,
      channel: body.channel ?? 'WEB',
    });
    this.logger.log(`[AGENT FINISHED] ${Date.now() - agentStart}ms`);
    this.logger.log(`[REQUEST TOTAL] ${Date.now() - start}ms conversationId=${result.conversationId} status=${result.status}`);
    return result;
  }

  @Post('messages/stream')
  async stream(
    @Body(new ZodValidationPipe(chatSchema))
    body: z.infer<typeof chatSchema>,
    @Res() res: Response,
  ) {
    this.logger.log(`[REQUEST RECEIVED] ${new Date().toISOString()} POST /chat/messages/stream`);
    const start = Date.now();
    const businessId =
      body.businessId ?? (await this.businesses.getCurrentId());
    const agentStart = Date.now();
    const result = await this.agent.run({
      ...body,
      businessId,
      channel: body.channel ?? 'WEB',
      debug: true,
    });
    this.logger.log(`[AGENT FINISHED] ${Date.now() - agentStart}ms (stream)`);
    this.logger.log(`[REQUEST TOTAL] ${Date.now() - start}ms`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(
      `data: ${JSON.stringify({ type: 'delta', content: result.message })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        conversationId: result.conversationId,
        status: result.status,
        debug: result.debug,
      })}\n\n`,
    );
    res.end();
  }
}
