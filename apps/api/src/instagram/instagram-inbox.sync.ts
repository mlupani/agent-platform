import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AgentService } from '../ai/agents/agent.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { InstagramConfigService } from './instagram-config.service';
import { InstagramMessagingProvider } from './instagram.messaging-provider';
import { InstagramService } from './instagram.service';
import type {
  InstagramDirectMessage,
  InstagramDirectThread,
  InstagramNormalizedInbound,
  InstagramThreadUser,
} from './instagram.types';

/**
 * aiograpi-rest NO expone webhooks/WebSocket para DMs.
 * Este servicio hace polling controlado + rehidratación de sesión.
 * Los eventos al dashboard sí van por el WebSocket existente de Nest.
 */
@Injectable()
export class InstagramInboxSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstagramInboxSyncService.name);
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private tickInflight = false;
  private readonly sessionFailUntil = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: InstagramConfigService,
    private readonly instagram: InstagramService,
    private readonly provider: InstagramMessagingProvider,
    private readonly agent: AgentService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  onModuleInit() {
    const interval = this.config.syncIntervalMs();
    this.logger.log(
      `Instagram inbox sync activo (polling cada ${interval}ms; sin webhook en aiograpi-rest)`,
    );
    // Primer ciclo inmediato: no esperar el primer intervalo
    void this.tick();
    this.scheduleNext(interval);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(interval: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        this.scheduleNext(this.config.syncIntervalMs());
      });
    }, interval);
  }

  async tick(): Promise<void> {
    if (this.tickInflight) return;
    this.tickInflight = true;
    try {
      const businessIds = await this.config.listEnabledBusinessIds();
      for (const businessId of businessIds) {
        await this.syncBusiness(businessId);
      }
    } catch (error) {
      this.logger.warn(
        `Instagram tick failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    } finally {
      this.tickInflight = false;
    }
  }

  async syncBusiness(businessId: string): Promise<number> {
    const failUntil = this.sessionFailUntil.get(businessId) ?? 0;
    if (Date.now() < failUntil) return 0;

    const lockKey = `ig:sync:${businessId}`;
    const acquired = await this.redis.acquireLock(lockKey, 120);
    if (!acquired) return 0;

    try {
      const alive = await this.instagram.ensureLiveSession(businessId);
      if (!alive) {
        // Evitar spamear aiograpi cada 8s mientras el login está roto
        this.sessionFailUntil.set(businessId, Date.now() + 60_000);
        return 0;
      }
      this.sessionFailUntil.delete(businessId);

      const cfg = await this.config.getForRuntime(businessId);
      if (!cfg?.enabled || !cfg.sessionIdEnc) return 0;

      // Sin lastSyncAt: anclar cutoff al inicio del ciclo (historial = backfill)
      const agentCutoff = cfg.lastSyncAt ?? new Date();
      // Preferir unread; si no hay, traer threads recientes
      let threads = await this.instagram.listThreads(businessId, 15, {
        messageLimit: 20,
        unreadOnly: true,
      });
      if (!threads.length) {
        threads = await this.instagram.listThreads(businessId, 12, {
          messageLimit: 15,
          unreadOnly: false,
        });
      }

      let processed = 0;
      for (const thread of threads) {
        const threadId = this.instagram.threadId(thread);
        if (!threadId) continue;

        let messages = Array.isArray(thread.messages) ? thread.messages : [];
        if (messages.length < 2) {
          messages = await this.instagram.listMessages(
            businessId,
            threadId,
            25,
          );
        }

        const ordered = [...messages].reverse();
        for (const message of ordered) {
          const ok = await this.processMessage({
            businessId,
            thread,
            threadId,
            message,
            ownUserId: cfg.userId,
            agentCutoff,
          });
          if (ok) processed += 1;
        }
      }

      await this.config.markSynced(businessId);
      this.realtime.instagramStatusChanged(businessId, {
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
        username: cfg.username,
      });
      if (processed > 0) {
        this.logger.log(
          `Instagram sync ${businessId}: ${processed} mensaje(s) nuevo(s)`,
        );
      }
      return processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Instagram sync ${businessId}: ${message}`);
      if (/401|sesión|session not found|relgin|relogin/i.test(message)) {
        const restored = await this.instagram.ensureLiveSession(businessId);
        if (!restored) {
          await this.config.setStatus(businessId, 'error', message);
          this.realtime.instagramStatusChanged(businessId, {
            status: 'error',
            lastError: message,
          });
        }
      }
      return 0;
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  private async processMessage(input: {
    businessId: string;
    thread: InstagramDirectThread;
    threadId: string;
    message: InstagramDirectMessage;
    ownUserId: string | null;
    agentCutoff: Date;
  }): Promise<boolean> {
    const text = String(input.message.text ?? '').trim();
    const externalMessageId = this.instagram.messageId(input.message);
    if (!text || !externalMessageId) return false;

    const existing = await this.prisma.message.findFirst({
      where: {
        businessId: input.businessId,
        externalId: externalMessageId,
      },
    });
    if (existing) return false;

    const fromMe =
      input.message.is_sent_by_viewer === true ||
      (input.ownUserId != null &&
        String(input.message.user_id ?? '') === String(input.ownUserId));

    const peer = this.pickPeer(input.thread, input.ownUserId);
    const normalized: InstagramNormalizedInbound = {
      channel: 'INSTAGRAM',
      externalUserId: peer
        ? String(peer.pk ?? peer.id ?? '')
        : String(input.message.user_id ?? ''),
      externalUsername: peer?.username,
      externalConversationId: input.threadId,
      externalMessageId,
      text,
      contactName: peer?.full_name || peer?.username,
      contactAvatarUrl: peer?.profile_pic_url,
      timestamp: this.toDate(input.message.timestamp),
      fromMe,
    };

    if (!normalized.externalUserId && !fromMe) return false;

    const dedupeKey = `ig:msgid:${input.businessId}:${externalMessageId}`;
    const claimed = await this.redis.acquireLock(dedupeKey, 60 * 60 * 24);
    if (!claimed) return false;

    try {
      return await this.persistAndRoute(input.businessId, normalized, {
        threadId: input.threadId,
        agentCutoff: input.agentCutoff,
        fromMe,
      });
    } catch (error) {
      await this.redis.releaseLock(dedupeKey);
      throw error;
    }
  }

  private async persistAndRoute(
    businessId: string,
    normalized: InstagramNormalizedInbound,
    opts: {
      threadId: string;
      agentCutoff: Date;
      fromMe: boolean;
    },
  ): Promise<boolean> {
    const { text, externalMessageId } = normalized;
    const user = await this.upsertUser(businessId, normalized);
    let conversation = await this.upsertConversation(
      businessId,
      user.id,
      normalized,
    );

    if (conversation.hiddenAt) {
      const msgTs = normalized.timestamp ?? new Date();
      // Solo un mensaje nuevo del cliente después de eliminar la vuelve a mostrar
      if (opts.fromMe || msgTs <= conversation.hiddenAt) {
        return false;
      }
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          hiddenAt: null,
          status: 'AI',
          unreadCount: 0,
        },
      });
      this.realtime.conversationUpdated(businessId, {
        conversationId: conversation.id,
        status: conversation.status,
        hidden: false,
        channel: 'INSTAGRAM',
      });
    }

    if (opts.fromMe) {
      // Eco de mensajes que ya enviamos como AI: no duplicar como HUMAN
      const recentAi = await this.prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          businessId,
          sender: 'AI',
          content: text,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recentAi) {
        if (!recentAi.externalId) {
          await this.prisma.message.update({
            where: { id: recentAi.id },
            data: { externalId: externalMessageId, status: 'sent' },
          });
        }
        return false;
      }

      const message = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          businessId,
          role: 'assistant',
          sender: 'HUMAN',
          content: text,
          externalId: externalMessageId,
          status: 'sent',
          createdAt: normalized.timestamp ?? undefined,
          metadata: {
            source: 'instagram_from_me',
            channel: 'INSTAGRAM',
          },
        },
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: normalized.timestamp ?? new Date(),
          lastMessagePreview: text.slice(0, 280),
          lastMessageSender: 'HUMAN',
          unreadCount: { increment: 0 },
        },
      });
      this.realtime.conversationMessageCreated(businessId, {
        conversationId: conversation.id,
        message,
      });
      this.realtime.conversationUpdated(businessId, {
        conversationId: conversation.id,
        status: conversation.status,
        lastMessageAt: message.createdAt,
        lastMessagePreview: text.slice(0, 280),
        lastMessageSender: 'HUMAN',
        channel: 'INSTAGRAM',
      });
      return true;
    }

    // Margen de 2 min por desfase de reloj / microsegundos de Instagram.
    const cutoffMs = opts.agentCutoff.getTime() - 120_000;
    const ts = normalized.timestamp?.getTime();
    const shouldRunAgent = ts == null || ts >= cutoffMs;

    if (!shouldRunAgent) {
      const message = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          businessId,
          role: 'user',
          sender: 'CLIENT',
          content: text,
          externalId: externalMessageId,
          status: 'received',
          createdAt: normalized.timestamp ?? undefined,
          metadata: {
            source: 'instagram_backfill',
            channel: 'INSTAGRAM',
            externalUsername: normalized.externalUsername,
          },
        },
      });
      const updated = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: normalized.timestamp ?? new Date(),
          lastMessagePreview: text.slice(0, 280),
          lastMessageSender: 'CLIENT',
          unreadCount: { increment: 1 },
        },
      });
      this.realtime.conversationMessageCreated(businessId, {
        conversationId: conversation.id,
        message,
      });
      this.realtime.conversationUpdated(businessId, {
        conversationId: conversation.id,
        lastMessageAt: message.createdAt,
        lastMessagePreview: text.slice(0, 280),
        lastMessageSender: 'CLIENT',
        unreadCount: updated.unreadCount,
        channel: 'INSTAGRAM',
      });
      return true;
    }

    const previousStatus = conversation.status;
    let result;
    try {
      result = await this.agent.run({
        businessId,
        conversationId: conversation.id,
        userId: user.id,
        channel: 'INSTAGRAM',
        message: text,
        metadata: {
          contactName: normalized.contactName,
          contactUsername: normalized.externalUsername,
          externalMessageId,
          wamid: externalMessageId,
          channel: 'INSTAGRAM',
        },
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: string }).code)
          : '';
      if (code === 'P2002') return false;
      throw error;
    }

    const clientMessage = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        businessId,
        sender: 'CLIENT',
        externalId: externalMessageId,
      },
      orderBy: { createdAt: 'desc' },
    });

    const afterInbound = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { unreadCount: true, lastMessageAt: true },
    });

    this.realtime.conversationMessageCreated(businessId, {
      conversationId: conversation.id,
      message: clientMessage,
    });
    this.realtime.conversationUpdated(businessId, {
      conversationId: conversation.id,
      status: previousStatus,
      lastMessageAt:
        afterInbound?.lastMessageAt?.toISOString() ?? new Date().toISOString(),
      lastMessagePreview: text.slice(0, 280),
      lastMessageSender: 'CLIENT',
      unreadCount: afterInbound?.unreadCount,
      channel: 'INSTAGRAM',
    });

    if (previousStatus === 'AI' && result.status === 'AI' && result.message) {
      try {
        const sent = await this.provider.sendText({
          businessId,
          to: conversation.externalId || opts.threadId,
          body: result.message,
        });
        if (sent.externalId) {
          const outboundId = String(sent.externalId);
          await this.redis.acquireLock(
            `ig:msgid:${businessId}:${outboundId}`,
            60 * 60 * 24,
          );
          const lastAi = await this.prisma.message.findFirst({
            where: {
              conversationId: conversation.id,
              businessId,
              sender: 'AI',
              externalId: null,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (lastAi) {
            const updated = await this.prisma.message.update({
              where: { id: lastAi.id },
              data: {
                externalId: outboundId,
                status: 'sent',
              },
            });
            this.realtime.conversationMessageCreated(businessId, {
              conversationId: conversation.id,
              message: updated,
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to send Instagram AI reply: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    } else if (result.status !== previousStatus) {
      this.realtime.conversationBotStatusChanged(businessId, {
        conversationId: conversation.id,
        status: result.status,
        botActive: result.status === 'AI',
      });
    }

    this.realtime.conversationUpdated(businessId, {
      conversationId: conversation.id,
      status: result.status,
      channel: 'INSTAGRAM',
    });

    return true;
  }

  private pickPeer(
    thread: InstagramDirectThread,
    ownUserId: string | null,
  ): InstagramThreadUser | undefined {
    const users = thread.users ?? [];
    if (!users.length) return undefined;
    if (!ownUserId) return users[0];
    return (
      users.find((user) => String(user.pk ?? user.id ?? '') !== ownUserId) ??
      users[0]
    );
  }

  private async upsertUser(
    businessId: string,
    inbound: InstagramNormalizedInbound,
  ) {
    const externalId = `ig:${inbound.externalUserId}`;
    const existing = await this.prisma.user.findFirst({
      where: { businessId, externalId },
    });
    if (existing) {
      if (inbound.contactName && existing.name !== inbound.contactName) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { name: inbound.contactName },
        });
      }
      return existing;
    }
    return this.prisma.user.create({
      data: {
        businessId,
        externalId,
        name: inbound.contactName ?? inbound.externalUsername ?? null,
        metadata: {
          channel: 'INSTAGRAM',
          username: inbound.externalUsername,
        },
      },
    });
  }

  private async upsertConversation(
    businessId: string,
    userId: string,
    inbound: InstagramNormalizedInbound,
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        businessId,
        channel: 'INSTAGRAM',
        externalId: inbound.externalConversationId,
      },
    });
    if (existing) {
      // Conversación eliminada de la bandeja: no revivir con sync histórico
      if (existing.hiddenAt) {
        return existing;
      }
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          userId,
          contactName: inbound.contactName ?? undefined,
          contactUsername: inbound.externalUsername ?? undefined,
          contactAvatarUrl: inbound.contactAvatarUrl ?? undefined,
        },
      });
    }
    return this.prisma.conversation.create({
      data: {
        businessId,
        userId,
        channel: 'INSTAGRAM',
        status: 'AI',
        externalId: inbound.externalConversationId,
        contactName: inbound.contactName ?? null,
        contactUsername: inbound.externalUsername ?? null,
        contactAvatarUrl: inbound.contactAvatarUrl ?? null,
        metadata: {
          channel: 'INSTAGRAM',
          externalUserId: inbound.externalUserId,
        },
      },
    });
  }

  private toDate(value?: string | number | null): Date | null {
    if (value == null || value === '') return null;
    const numeric =
      typeof value === 'number'
        ? value
        : /^\d+(\.\d+)?$/.test(String(value).trim())
          ? Number(value)
          : NaN;

    if (Number.isFinite(numeric)) {
      // Instagram Direct suele usar microsegundos (> 1e14)
      let ms = numeric;
      if (numeric > 1e14) ms = Math.floor(numeric / 1000);
      else if (numeric < 1e11) ms = Math.floor(numeric * 1000);
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
