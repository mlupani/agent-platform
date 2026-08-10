import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AgentService } from '../ai/agents/agent.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const chatSchema = z.object({
  businessId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
  channel: z.string().optional(),
  userId: z.string().uuid().optional(),
  agentConfigId: z.string().uuid().optional(),
  debug: z.boolean().optional(),
  confirmed: z.boolean().optional(),
});

@Controller('chat')
export class ChatController {
  constructor(private readonly agent: AgentService) {}

  @Post('messages')
  send(
    @Body(new ZodValidationPipe(chatSchema))
    body: z.infer<typeof chatSchema>,
  ) {
    return this.agent.run({
      ...body,
      channel: body.channel ?? 'WEB',
    });
  }

  @Post('messages/stream')
  async stream(
    @Body(new ZodValidationPipe(chatSchema))
    body: z.infer<typeof chatSchema>,
    @Res() res: Response,
  ) {
    const result = await this.agent.run({
      ...body,
      channel: body.channel ?? 'WEB',
      debug: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ type: 'delta', content: result.message })}\n\n`);
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
