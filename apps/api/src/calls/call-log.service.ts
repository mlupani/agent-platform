import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';

/**
 * Registro de llamadas de voz (Vapi): crea el `CallLog` al entrar la llamada,
 * actualiza su estado durante la conversación y lo completa con el reporte final,
 * cerrando además la `Conversation` asociada.
 */
/** Códigos de Prisma que significan "el registro no existe (todavía)". */
const NOT_FOUND_CODES = new Set(['P2025', 'P2016']);

@Injectable()
export class CallLogService {
  private readonly logger = new Logger(CallLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /**
   * Crea (o refresca) el `CallLog` de una llamada entrante. Idempotente: usa
   * `upsert` keyeado por `vapiCallId`, así reintentos del webhook no duplican.
   */
  async startInboundCall(params: {
    businessId: string;
    vapiCallId: string;
    conversationId: string;
    fromNumber?: string | null;
    toNumber?: string | null;
  }): Promise<void> {
    await this.prisma.callLog.upsert({
      where: { vapiCallId: params.vapiCallId },
      create: {
        businessId: params.businessId,
        conversationId: params.conversationId,
        vapiCallId: params.vapiCallId,
        direction: 'inbound',
        status: 'ringing',
        fromNumber: params.fromNumber ?? null,
        toNumber: params.toNumber ?? null,
      },
      update: { conversationId: params.conversationId },
    });
  }

  /**
   * Actualiza el estado de la llamada. Normaliza `in-progress`/`ended` y setea
   * `startedAt`/`endedAt` según corresponda. Nunca re-lanza: si el `CallLog`
   * todavía no existe (P2025/P2016) se ignora con `warn`; cualquier otro fallo
   * se registra a nivel `error`.
   */
  async updateStatus(vapiCallId: string, status: string): Promise<void> {
    const normalized =
      status === 'in-progress'
        ? 'in-progress'
        : status === 'ended'
          ? 'ended'
          : status;
    try {
      await this.prisma.callLog.update({
        where: { vapiCallId },
        data: {
          status: normalized,
          ...(normalized === 'in-progress' ? { startedAt: new Date() } : {}),
          ...(normalized === 'ended' ? { endedAt: new Date() } : {}),
        },
      });
    } catch (error) {
      this.logNonThrowingFailure('updateStatus', vapiCallId, error);
    }
  }

  /**
   * Completa el `CallLog` con el reporte final de Vapi (motivo, tiempos, costo,
   * transcript, resumen) y, si tiene `conversationId`, cierra la `Conversation`
   * y emite `realtime.conversationUpdated`. Nunca re-lanza: un `vapiCallId`
   * desconocido (P2025/P2016) se ignora con `warn`; cualquier otro fallo se
   * registra a nivel `error`. En ambos casos el cierre de conversación se saltea.
   */
  async finalizeFromReport(params: {
    vapiCallId: string;
    endedReason?: string;
    startedAt?: string;
    endedAt?: string;
    costUsd?: number;
    transcript?: string;
    summary?: string;
  }): Promise<void> {
    const startedAt = params.startedAt ? new Date(params.startedAt) : undefined;
    const endedAt = params.endedAt ? new Date(params.endedAt) : new Date();
    const durationSeconds =
      startedAt && endedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
        : undefined;

    let log: { businessId: string; conversationId: string | null } | null = null;
    try {
      log = await this.prisma.callLog.update({
        where: { vapiCallId: params.vapiCallId },
        data: {
          status: 'ended',
          endedReason: params.endedReason ?? null,
          startedAt,
          endedAt,
          durationSeconds,
          costUsd: params.costUsd ?? null,
          transcript: params.transcript ?? null,
          summary: params.summary ?? null,
        },
        select: { businessId: true, conversationId: true },
      });
    } catch (error) {
      this.logNonThrowingFailure('finalizeFromReport', params.vapiCallId, error);
      return;
    }

    if (log.conversationId) {
      await this.prisma.conversation.update({
        where: { id: log.conversationId },
        data: {
          status: 'CLOSED',
          summary: params.summary ?? undefined,
          lastMessagePreview: params.summary?.slice(0, 280) ?? undefined,
        },
      });
      this.realtime.conversationUpdated(log.businessId, {
        conversationId: log.conversationId,
        status: 'CLOSED',
      });
    }
  }

  /**
   * Registra un fallo de escritura que NO se re-lanza (los webhooks de Vapi
   * deben responder 200 siempre). Distingue el caso esperado "el registro no
   * existe todavía" (P2025/P2016) → `warn`, de cualquier otro fallo real
   * (caída de DB, query malformada, bug) → `error`, para que no se pierda en
   * silencio en producción.
   */
  private logNonThrowingFailure(
    method: string,
    vapiCallId: string,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code;
    if (code && NOT_FOUND_CODES.has(code)) {
      this.logger.warn(`${method}(${vapiCallId}) ignorado (registro inexistente): ${message}`);
      return;
    }
    this.logger.error(`${method}(${vapiCallId}) falló sin re-lanzar: ${message}`);
  }
}
