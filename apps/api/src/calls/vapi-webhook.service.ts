import { Injectable, Logger } from '@nestjs/common';
import type { Business, VapiCallConfig } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { LeadsService } from '../leads/leads.service';
import { CallConfigService } from './call-config.service';
import { CallLogService } from './call-log.service';
import { DEFAULT_CONFIGURED_MESSAGES } from '../common/constants';
import type { VapiServerMessage } from './calls.types';

/** Texto que Vapi le dice al llamante cuando no hay asistente disponible. */
const DISABLED_MESSAGE = 'El asistente de voz no está disponible en este momento.';

/**
 * Maneja los eventos de servidor de Vapi (`assistant-request`, `status-update`,
 * `end-of-call-report`, `hang`). Ante `assistant-request` devolvemos un
 * asistente transitorio cuyo custom-llm apunta de vuelta a nuestro webhook, así
 * cada turno de la conversación lo resuelve el core del agente (VapiBridgeService).
 */
@Injectable()
export class VapiWebhookService {
  private readonly logger = new Logger(VapiWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly callConfig: CallConfigService,
    private readonly callLog: CallLogService,
    private readonly businesses: BusinessesService,
    private readonly leads: LeadsService,
  ) {}

  /** `true` sólo si el header trae el mismo secret que guardó el negocio. */
  async verifySecret(headerValue: string | undefined): Promise<boolean> {
    if (!headerValue) return false;
    const secret = await this.callConfig.getWebhookSecret();
    return Boolean(secret) && headerValue === secret;
  }

  /**
   * Router por `message.type`. Devuelve el body de respuesta: `{ assistant }` o
   * `{ error }` para `assistant-request`, `{}` para el resto de los eventos.
   */
  async handleEvent(message: VapiServerMessage): Promise<Record<string, unknown>> {
    switch (message.type) {
      case 'assistant-request':
        return this.handleAssistantRequest(message);
      case 'status-update':
        if (message.call?.id && message.status) {
          await this.callLog.updateStatus(message.call.id, message.status);
        }
        return {};
      case 'end-of-call-report':
        if (message.call?.id) {
          await this.callLog.finalizeFromReport({
            vapiCallId: message.call.id,
            endedReason: message.endedReason,
            startedAt: message.startedAt,
            endedAt: message.endedAt,
            costUsd: message.cost,
            transcript: message.artifact?.transcript,
            summary: message.analysis?.summary,
          });
        }
        return {};
      case 'hang':
        this.logger.warn(`Vapi hang en call=${message.call?.id ?? '?'}`);
        return {};
      default:
        return {};
    }
  }

  /**
   * `assistant-request`: valida que la config esté habilitada, arranca (o
   * refresca) la `Conversation` VOICE y el `CallLog`, captura el lead con el
   * teléfono del llamante y devuelve el asistente transitorio.
   */
  private async handleAssistantRequest(
    message: VapiServerMessage,
  ): Promise<Record<string, unknown>> {
    const config = await this.callConfig.getForRuntime();
    if (!config || !config.enabled || !config.agentEnabled) {
      return { error: DISABLED_MESSAGE };
    }

    const businessId = config.businessId;
    // Cargar el negocio es requisito: si la DB está caída (throw) o el negocio
    // no existe, degradamos con un "no disponible" en vez de tirar 500 a Vapi.
    let business: Business | null;
    try {
      business = await this.prisma.business.findUnique({ where: { id: businessId } });
    } catch (error) {
      this.logger.error(
        `assistant-request: no se pudo cargar el negocio ${businessId}: ${(error as Error).message}`,
      );
      return { error: DISABLED_MESSAGE };
    }
    if (!business) return { error: DISABLED_MESSAGE };

    // El registro de la llamada (conversación + CallLog + lead) es best-effort:
    // el asistente transitorio sólo necesita `config` + `business`, así que un
    // fallo de bookkeeping se loguea y no bloquea la respuesta.
    const callId = message.call?.id ?? '';
    const phone =
      message.call?.customer?.number ?? message.call?.phoneNumber?.number ?? null;

    if (callId) {
      try {
        const conversation = await this.upsertConversation(businessId, callId, phone);
        await this.callLog.startInboundCall({
          businessId,
          vapiCallId: callId,
          conversationId: conversation.id,
          fromNumber: phone,
        });
        if (phone) {
          try {
            await this.leads.capture({
              businessId,
              conversationId: conversation.id,
              phone,
              source: 'VOICE',
            });
          } catch (error) {
            this.logger.warn(`leads.capture (voz) falló: ${(error as Error).message}`);
          }
        }
      } catch (error) {
        this.logger.warn(
          `assistant-request: bookkeeping de la llamada ${callId} falló: ${(error as Error).message}`,
        );
      }
    }

    return { assistant: this.buildTransientAssistant(config, business) };
  }

  /** Busca la `Conversation` VOICE por `externalId === callId`; si no existe la crea. */
  private async upsertConversation(
    businessId: string,
    callId: string,
    phone: string | null,
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: { businessId, channel: 'VOICE', externalId: callId },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: {
        businessId,
        channel: 'VOICE',
        status: 'AI',
        externalId: callId,
        contactPhone: phone,
        metadata: { source: 'vapi-inbound' },
      },
    });
  }

  /**
   * Arma el objeto `assistant` transitorio que devolvemos a Vapi: modelo
   * custom-llm apuntando a nuestro webhook, voz/transcriber de la config y
   * `server` para recibir los eventos de fin de llamada.
   */
  private buildTransientAssistant(
    config: VapiCallConfig,
    business: { name: string; defaultMessages: unknown },
  ): Record<string, unknown> {
    const webhookUrl = this.callConfig.resolveWebhookUrl();
    const rawWelcome =
      typeof business.defaultMessages === 'object' && business.defaultMessages
        ? (business.defaultMessages as Record<string, unknown>).welcome
        : undefined;
    // Sólo un `welcome` string sirve como firstMessage; cualquier otra cosa en
    // la columna Json cae al default (Vapi rechazaría un firstMessage no-string).
    const welcome =
      typeof rawWelcome === 'string' && rawWelcome
        ? rawWelcome
        : DEFAULT_CONFIGURED_MESSAGES.welcome;

    const transcriber: Record<string, unknown> = {
      provider: 'deepgram',
      model: 'flux-general-multi',
    };
    if (config.transcriberLanguage) transcriber.language = config.transcriberLanguage;

    return {
      name: `${business.name} — Asistente`.slice(0, 40),
      firstMessage: config.firstMessage ?? welcome,
      firstMessageMode: 'assistant-speaks-first',
      model: {
        provider: 'custom-llm',
        model: 'agent-core',
        url: webhookUrl,
        headers: { 'x-vapi-secret': config.webhookSecret },
      },
      voice: { provider: config.voiceProvider, voiceId: config.voiceId, version: 2 },
      transcriber,
      server: { url: webhookUrl, secret: config.webhookSecret },
      metadata: { businessId: config.businessId, source: 'inbound' },
      analysisPlan: { summaryPlan: { enabled: true } },
    };
  }
}
