import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentService } from '../ai/agents/agent.service';
import { BusinessesService } from '../businesses/businesses.service';
import { CallLogService } from './call-log.service';
import type { VapiChatCompletionBody } from './calls.types';

/** Voz prioriza latencia: menos pasos del loop del agente por turno. */
const VOICE_MAX_STEPS = 4;
/** Texto que se le dice al usuario si algo falla del lado nuestro. */
const FALLBACK = 'Perdón, tuve un problema. ¿Podés repetir?';

/**
 * Puente turno-a-turno entre Vapi (custom-llm) y el core del agente.
 *
 * Vapi POSTea un request OpenAI `/chat/completions` por cada intervención del
 * usuario; acá corremos `AgentService.run` con canal VOICE y devolvemos la
 * respuesta como SSE OpenAI (o JSON si `stream === false`).
 *
 * Nunca lanza ni responde 500: ante cualquier error interno emite un chunk de
 * fallback y cierra el stream con 200, para que la llamada no se corte.
 */
@Injectable()
export class VapiBridgeService {
  private readonly logger = new Logger(VapiBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
    private readonly businesses: BusinessesService,
    private readonly callLog: CallLogService,
  ) {}

  async handleChatCompletion(
    body: VapiChatCompletionBody,
    res: Response,
  ): Promise<void> {
    const callId = body.call?.id ?? String(body.metadata?.callId ?? '');
    const streaming = body.stream !== false;
    let text = FALLBACK;

    try {
      const businessId =
        (typeof body.metadata?.businessId === 'string' &&
          body.metadata.businessId) ||
        (await this.businesses.getCurrentId());
      const phone = body.customer?.number ?? body.phoneNumber?.number ?? null;
      const conversation = await this.resolveConversation(
        businessId,
        callId,
        phone,
      );

      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'user' && (m.content ?? '').trim());
      const message = (lastUser?.content ?? '').trim();

      if (message) {
        const result = await this.agent.run({
          businessId,
          conversationId: conversation.id,
          channel: 'VOICE',
          maxStepsOverride: VOICE_MAX_STEPS,
          message,
          metadata: {
            vapiCallId: callId,
            contactPhone: conversation.contactPhone ?? phone,
          },
        });
        text = result.message?.trim() || FALLBACK;
      } else {
        // Turno vacío (silencio / ruido): stop chunk sin contenido, sin agente.
        text = '';
      }
    } catch (error) {
      this.logger.error(
        `bridge call=${callId} falló: ${(error as Error).message}`,
      );
      text = FALLBACK;
    }

    if (streaming) this.writeSse(res, callId, text);
    else this.writeJson(res, callId, text);
  }

  /** Busca la `Conversation` VOICE por `externalId === callId`; si no existe la crea y arranca el `CallLog`. */
  private async resolveConversation(
    businessId: string,
    callId: string,
    phone: string | null,
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: { businessId, channel: 'VOICE', externalId: callId },
    });
    if (existing) return existing;

    const created = await this.prisma.conversation.create({
      data: {
        businessId,
        channel: 'VOICE',
        status: 'AI',
        externalId: callId,
        contactPhone: phone,
        metadata: { source: 'vapi-inbound' },
      },
    });
    await this.callLog.startInboundCall({
      businessId,
      vapiCallId: callId,
      conversationId: created.id,
      fromNumber: phone,
    });
    return created;
  }

  /** Respuesta OpenAI en streaming: un chunk con el texto + un chunk `stop` + `[DONE]`. */
  private writeSse(res: Response, callId: string, text: string): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const id = `chatcmpl-${callId || Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const base = { id, object: 'chat.completion.chunk', created, model: 'agent-core' };
    res.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: text },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    );
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** Respuesta OpenAI no-streaming (`stream === false`). */
  private writeJson(res: Response, callId: string, text: string): void {
    res.status(200).json({
      id: `chatcmpl-${callId || Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'agent-core',
      choices: [
        { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
      ],
    });
  }
}
