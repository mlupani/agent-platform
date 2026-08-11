import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AgentService } from '../ai/agents/agent.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { WhatsAppConfigService } from './whatsapp-config.service';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';
import { WahaWhatsAppProvider } from './providers/waha.whatsapp-provider';

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: WhatsAppConfigService,
    private readonly providers: WhatsAppProviderFactory,
    private readonly waha: WahaWhatsAppProvider,
    private readonly agent: AgentService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /** Legacy Meta verify — kept for compatibility if verifyToken exists */
  async verifySubscription(query: Record<string, string | undefined>) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode !== 'subscribe' || !token || !challenge) return null;

    const configs = await this.prisma.whatsAppConfig.findMany({
      where: { enabled: true },
    });
    if (configs.some((item) => item.verifyToken === token)) return challenge;
    const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (envToken && envToken === token) return challenge;
    return null;
  }

  async handleWahaEvent(payload: unknown): Promise<{ processed: number }> {
    const body = payload as {
      event?: string;
      session?: string;
      me?: { id?: string; pushName?: string };
      payload?: Record<string, unknown>;
    };

    const event = body.event;
    const session = body.session || 'default';
    if (!event) return { processed: 0 };

    const waConfig = await this.config.findBySessionName(session);
    if (!waConfig) {
      this.logger.warn(`No WhatsApp config for WAHA session=${session}`);
      return { processed: 0 };
    }

    if (event === 'session.status') {
      await this.handleSessionStatus(waConfig.businessId, body);
      return { processed: 1 };
    }

    if (event === 'message' || event === 'message.any') {
      const ok = await this.handleIncomingMessage(waConfig.businessId, body);
      return { processed: ok ? 1 : 0 };
    }

    if (event === 'message.ack') {
      await this.handleAck(waConfig.businessId, body.payload ?? {});
      return { processed: 1 };
    }

    this.logger.log(`Ignoring WAHA event=${event}`);
    return { processed: 0 };
  }

  private async handleSessionStatus(
    businessId: string,
    body: {
      me?: { id?: string; pushName?: string };
      payload?: Record<string, unknown>;
    },
  ) {
    const sessionStatus = String(body.payload?.status ?? '');
    const status = this.waha.mapSessionStatus(sessionStatus);
    const meId = body.me?.id ?? null;
    const displayPhoneNumber = this.waha.phoneFromMeId(meId);

    await this.config.setStatus(businessId, status, null, {
      sessionStatus,
      meId,
      displayPhoneNumber,
    });

    this.realtime.whatsappStatusChanged(businessId, {
      status,
      sessionStatus,
      meId,
      displayPhoneNumber,
    });

    if (sessionStatus === 'SCAN_QR_CODE') {
      const qrDataUrl = await this.waha.fetchQrDataUrl(businessId);
      if (qrDataUrl) {
        this.realtime.whatsappQrUpdated(businessId, { qrDataUrl, status });
      }
    }
  }

  private async handleIncomingMessage(
    businessId: string,
    body: {
      session?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const payload = body.payload ?? {};
    const chatId = this.extractChatId(payload);
    const fromMe = payload.fromMe === true;

    const text = String(payload.body ?? '').trim();
    const externalId = this.normalizeExternalId(payload.id);
    const fromRaw = String(payload.from ?? chatId ?? '');
    if (!text || !externalId) return false;

    if (this.isNonConversationMessage(payload, chatId, fromRaw)) {
      this.logger.debug(
        `Non-conversation WAHA event ignored: chat=${chatId || fromRaw} id=${externalId}`,
      );
      return false;
    }

    const fresh = await this.claimExternalId(businessId, externalId);
    if (!fresh) {
      this.logger.log(`Duplicate WAHA message ignored: ${externalId}`);
      return false;
    }

    const selfChat = await this.isSelfChat(businessId, chatId);
    const from = fromRaw.replace(/@s\.whatsapp\.net$/i, '@c.us');
    const phoneCandidate = this.phoneFromPayload(payload, chatId);
    const waConfig = await this.config.getForRuntime(businessId);
    const phone =
      phoneCandidate ||
      (selfChat
        ? this.waha.phoneFromMeId(waConfig?.meId) || chatId.replace(/@.+$/, '')
        : chatId.replace(/@.+$/, ''));
    const contactName = selfChat
      ? 'Yo'
      : typeof payload._data === 'object' &&
          payload._data &&
          'notifyName' in (payload._data as object)
        ? String((payload._data as { notifyName?: string }).notifyName)
        : undefined;

    const existing = await this.prisma.message.findFirst({
      where: { businessId, externalId },
    });

    const user = await this.upsertUser(
      businessId,
      phone || chatId,
      contactName,
    );
    const conversation = await this.upsertConversation(
      businessId,
      user.id,
      chatId || from,
      phone || undefined,
      contactName,
    );

    // Cliente nuevo / chat importado en HUMAN: activar bot salvo pausa manual
    if (!fromMe && conversation.status === 'HUMAN') {
      const meta =
        conversation.metadata && typeof conversation.metadata === 'object'
          ? (conversation.metadata as Record<string, unknown>)
          : {};
      if (meta.statusReason !== 'operator_paused') {
        const updated = await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'AI',
            hiddenAt: null,
            metadata: {
              ...meta,
              statusReason: 'auto_enabled_inbound',
              statusChangedAt: new Date().toISOString(),
            } as object,
          },
        });
        conversation.status = updated.status;
        conversation.hiddenAt = updated.hiddenAt;
        conversation.metadata = updated.metadata;
      }
    }

    // Ya existía (p.ej. sync histórico): en chat "Yo" igual puede faltar respuesta del agente
    if (existing) {
      if (!(fromMe && selfChat)) return false;

      const hasReply = await this.prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          businessId,
          sender: 'AI',
          createdAt: { gt: existing.createdAt },
        },
      });
      if (hasReply) return false;

      this.logger.log(
        `Self-chat message already synced; running agent anyway: ${externalId}`,
      );
    }

    // fromMe en chats normales: solo persistir (eco del teléfono / outbound)
    // fromMe en chat "Yo": tratarlo como mensaje de prueba → corre el agente
    if (fromMe && !selfChat) {
      if (existing) return false;
      const createdAt = this.timestampToDate(
        typeof payload.timestamp === 'number' ? payload.timestamp : null,
      );
      const message = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          businessId,
          role: 'assistant',
          sender: 'HUMAN',
          content: text,
          externalId,
          status: 'sent',
          createdAt: createdAt ?? undefined,
          metadata: {
            source: 'waha_from_me',
            session: body.session ?? null,
          },
        },
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: createdAt ?? new Date(),
          lastMessagePreview: text.slice(0, 280),
          lastMessageSender: 'HUMAN',
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
      });
      return true;
    }

    // Evitar loop: si acabamos de enviar este mismo texto como AI, no re-procesar
    if (fromMe && selfChat) {
      const recentAi = await this.prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          businessId,
          sender: 'AI',
          content: text,
          createdAt: { gte: new Date(Date.now() - 15_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recentAi) {
        this.logger.log(`Self-chat echo of AI reply ignored: ${externalId}`);
        return false;
      }

      // Asegurar bot activo para pruebas en "Yo" (también si estaba cerrado/eliminado)
      if (conversation.status !== 'AI') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'AI', hiddenAt: null },
        });
        conversation.status = 'AI';
        conversation.hiddenAt = null;
      }
    }

    const previousStatus = conversation.status;
    let result;
    try {
      result = await this.agent.run({
        businessId,
        conversationId: conversation.id,
        userId: user.id,
        channel: 'WHATSAPP',
        message: text,
        metadata: {
          contactName,
          contactPhone: phone,
          wamid: externalId,
          session: body.session,
          selfChatTest: selfChat && fromMe ? true : undefined,
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
        externalId,
      },
      orderBy: { createdAt: 'desc' },
    });

    const afterInbound = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: {
        unreadCount: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        lastMessageSender: true,
      },
    });

    this.realtime.conversationMessageCreated(businessId, {
      conversationId: conversation.id,
      message: clientMessage,
    });
    this.realtime.conversationUpdated(businessId, {
      conversationId: conversation.id,
      status: previousStatus,
      lastMessageAt: afterInbound?.lastMessageAt,
      lastMessagePreview: afterInbound?.lastMessagePreview,
      lastMessageSender: afterInbound?.lastMessageSender,
      unreadCount: afterInbound?.unreadCount,
    });

    if (previousStatus === 'AI' && result.status === 'AI' && result.message) {
      try {
        const provider = await this.providers.getForBusiness(businessId);
        const sent = await provider.sendText({
          businessId,
          to: conversation.externalId || chatId || from,
          body: result.message,
        });
        if (sent.externalId) {
          const outboundId = String(sent.externalId);
          await this.claimExternalId(businessId, outboundId);
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
          `Failed to send WAHA AI reply: ${
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
    });

    return true;
  }

  private async handleAck(
    businessId: string,
    payload: Record<string, unknown>,
  ) {
    const externalId = String(payload.id ?? '');
    if (!externalId) return;

    const ack = payload.ack;
    const status =
      ack === 3 || ack === 'READ'
        ? 'read'
        : ack === 2 || ack === 'DEVICE'
          ? 'delivered'
          : ack === 1 || ack === 'SERVER'
            ? 'sent'
            : String(ack ?? 'updated');

    await this.prisma.message.updateMany({
      where: { businessId, externalId },
      data: { status },
    });

    this.realtime.messageStatusUpdated(businessId, {
      externalId,
      status,
    });
  }

  private async claimExternalId(
    businessId: string,
    externalId: string,
  ): Promise<boolean> {
    return this.redis.acquireLock(
      `wa:msgid:${businessId}:${externalId}`,
      60 * 60 * 24,
    );
  }

  private async upsertUser(
    businessId: string,
    phone: string,
    name?: string,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { businessId, phone },
    });
    if (existing) {
      if (name && !existing.name) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing;
    }
    return this.prisma.user.create({
      data: {
        businessId,
        phone,
        name,
        externalId: phone,
      },
    });
  }

  private normalizeExternalId(id: unknown): string {
    if (typeof id === 'string' && id.trim()) return id;
    if (id && typeof id === 'object') {
      const obj = id as { _serialized?: string; id?: string };
      if (typeof obj._serialized === 'string' && obj._serialized.trim()) {
        return obj._serialized;
      }
      if (typeof obj.id === 'string' && obj.id.trim()) return obj.id;
    }
    return '';
  }

  private timestampToDate(timestamp?: number | null): Date | null {
    if (!timestamp || !Number.isFinite(timestamp)) return null;
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isNonConversationMessage(
    payload: Record<string, unknown>,
    chatId: string,
    fromRaw: string,
  ): boolean {
    const targets = [chatId, fromRaw, String(payload.to ?? '')];
    if (
      targets.some(
        (value) =>
          value.includes('@g.us') ||
          value.includes('@newsletter') ||
          value.includes('@broadcast') ||
          value.startsWith('status@') ||
          value === 'status@broadcast' ||
          value === '0@c.us',
      )
    ) {
      return true;
    }

    // WEBJS / WAHA a veces marcan estados explícitamente
    if (
      payload.isStatus === true ||
      payload.isStatusBroadcast === true ||
      payload.broadcast === true
    ) {
      return true;
    }

    const data = payload._data;
    if (data && typeof data === 'object') {
      const meta = data as {
        isStatus?: boolean;
        isStatusBroadcast?: boolean;
        broadcast?: boolean;
      };
      if (
        meta.isStatus === true ||
        meta.isStatusBroadcast === true ||
        meta.broadcast === true
      ) {
        return true;
      }
    }

    return false;
  }

  private async isSelfChat(
    businessId: string,
    chatId: string,
  ): Promise<boolean> {
    if (!chatId) return false;
    const waConfig = await this.config.getForRuntime(businessId);
    if (waConfig?.meId && chatId === waConfig.meId) return true;
    try {
      const me = await this.waha.getSessionMe(businessId);
      if (me?.id && chatId === me.id) return true;
      if (me?.lid && chatId === me.lid) return true;
    } catch {
      // ignore
    }
    return false;
  }

  private extractChatId(payload: Record<string, unknown>): string {
    const data = payload._data;
    if (data && typeof data === 'object') {
      const id = (data as { id?: { remote?: unknown } }).id?.remote;
      if (typeof id === 'string' && id.includes('@')) return id;
      if (
        id &&
        typeof id === 'object' &&
        '_serialized' in id &&
        typeof (id as { _serialized?: string })._serialized === 'string'
      ) {
        return (id as { _serialized: string })._serialized;
      }
    }
    const messageId = String(payload.id ?? '');
    const match = messageId.match(/^(?:true|false)_(.+?)_[^_]+$/);
    if (match?.[1]?.includes('@')) return match[1];
    if (payload.fromMe === true && typeof payload.to === 'string') {
      return String(payload.to);
    }
    return String(payload.from ?? '');
  }

  private phoneFromPayload(
    payload: Record<string, unknown>,
    chatId: string,
  ): string | null {
    if (chatId.endsWith('@c.us') && !chatId.startsWith('0@')) {
      return chatId.replace(/@c\.us$/i, '');
    }
    for (const key of ['from', 'to'] as const) {
      const value = payload[key];
      if (
        typeof value === 'string' &&
        /@c\.us$/i.test(value) &&
        !value.startsWith('0@')
      ) {
        return value.replace(/@c\.us$/i, '');
      }
    }
    return null;
  }

  private async upsertConversation(
    businessId: string,
    userId: string,
    chatId: string,
    phone?: string,
    contactName?: string,
  ) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        businessId,
        channel: 'WHATSAPP',
        OR: [{ externalId: chatId }, ...(phone ? [{ externalId: phone }] : [])],
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      const metaBase =
        existing.metadata && typeof existing.metadata === 'object'
          ? { ...(existing.metadata as Record<string, unknown>) }
          : {};
      const reopen =
        existing.status === 'CLOSED' || existing.hiddenAt != null;
      if (reopen) {
        delete metaBase.hiddenReason;
        delete metaBase.hiddenAt;
        metaBase.reopenedAt = new Date().toISOString();
        metaBase.reopenedReason = 'inbound_message';
      }

      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          externalId: chatId,
          contactPhone: phone ?? existing.contactPhone,
          contactName: contactName ?? existing.contactName,
          userId,
          // Actividad nueva vuelve a mostrar chats ocultos/cerrados
          hiddenAt: null,
          ...(reopen
            ? {
                status: 'AI' as const,
                metadata: metaBase as object,
              }
            : {}),
        },
      });
    }

    const agent = await this.prisma.agentConfig.findFirst({
      where: { businessId, isDefault: true },
    });

    return this.prisma.conversation.create({
      data: {
        businessId,
        userId,
        agentConfigId: agent?.id,
        channel: 'WHATSAPP',
        status: 'AI',
        externalId: chatId,
        contactPhone: phone,
        contactName,
      },
    });
  }
}
