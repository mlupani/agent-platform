import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';

/**
 * Registro de llamadas de voz (Vapi): crea el `CallLog` al entrar la llamada,
 * actualiza su estado durante la conversación y lo completa con el reporte final,
 * cerrando además la `Conversation` asociada.
 */
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
   * `startedAt`/`endedAt` según corresponda. Si el `CallLog` todavía no existe
   * (la llamada puede no haber entrado aún), se ignora con un `warn`.
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
      this.logger.warn(
        `updateStatus(${vapiCallId}) ignorado: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Completa el `CallLog` con el reporte final de Vapi (motivo, tiempos, costo,
   * transcript, resumen) y, si tiene `conversationId`, cierra la `Conversation`
   * y emite `realtime.conversationUpdated`. Tolera un `vapiCallId` desconocido
   * (P2025) sin lanzar.
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
      this.logger.warn(
        `finalizeFromReport(${params.vapiCallId}) ignorado: ${(error as Error).message}`,
      );
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
}
