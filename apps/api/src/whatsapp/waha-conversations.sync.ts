import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { WahaWhatsAppProvider } from './providers/waha.whatsapp-provider';
import type {
  WahaChatMessage,
  WahaChatOverview,
} from './providers/waha.whatsapp-provider';
import { WhatsAppConfigService } from './whatsapp-config.service';

@Injectable()
export class WahaConversationsSyncService {
  private readonly logger = new Logger(WahaConversationsSyncService.name);
  private readonly lastChatSync = new Map<string, number>();
  private readonly chatSyncInflight = new Map<string, Promise<number>>();
  private static readonly CHAT_SYNC_TTL_MS = 12_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaWhatsAppProvider,
    private readonly config: WhatsAppConfigService,
  ) {}

  async syncChats(businessId: string, options?: { force?: boolean }) {
    const now = Date.now();
    const last = this.lastChatSync.get(businessId) ?? 0;
    if (
      !options?.force &&
      now - last < WahaConversationsSyncService.CHAT_SYNC_TTL_MS
    ) {
      return 0;
    }

    // Force: invalidar TTL para corregir orden tras cambios
    if (options?.force) {
      this.lastChatSync.delete(businessId);
    }

    const inflight = this.chatSyncInflight.get(businessId);
    if (inflight) return inflight;

    const job = this.runChatSync(businessId)
      .then((count) => {
        this.lastChatSync.set(businessId, Date.now());
        return count;
      })
      .finally(() => {
        this.chatSyncInflight.delete(businessId);
      });

    this.chatSyncInflight.set(businessId, job);
    return job;
  }

  async syncMessages(businessId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessId, channel: 'WHATSAPP' },
    });
    if (!conversation?.externalId) return 0;

    const chatId = conversation.externalId;
    let messages: WahaChatMessage[] = [];
    try {
      messages = await this.waha.getChatMessages(businessId, chatId, {
        limit: 80,
        downloadMedia: false,
      });
    } catch (error) {
      this.logger.warn(
        `WAHA messages sync failed chat=${chatId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 0;
    }

    let upserted = 0;
    for (const item of messages) {
      const externalId = this.messageExternalId(item);
      if (!externalId) continue;
      const content = this.messageContent(item);
      if (!content) continue;

      const sender = item.fromMe ? 'HUMAN' : 'CLIENT';
      const role = item.fromMe ? 'assistant' : 'user';
      const createdAt = this.toDate(item.timestamp) ?? new Date();

      const existing = await this.prisma.message.findFirst({
        where: { businessId, externalId },
      });
      if (existing) {
        if (existing.conversationId !== conversation.id) continue;
        continue;
      }

      try {
        await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            businessId,
            role,
            sender,
            content,
            externalId,
            status: item.fromMe
              ? this.mapAck(item.ack, item.ackName)
              : 'received',
            createdAt,
            metadata: {
              source: 'waha_sync',
              from: item.from ?? null,
              to: item.to ?? null,
              hasMedia: Boolean(item.hasMedia),
            },
          },
        });
        upserted += 1;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: string }).code)
            : '';
        if (code !== 'P2002') {
          this.logger.warn(
            `Message upsert failed ${externalId}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }

    const last = [...messages].sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
    )[messages.length - 1];
    if (last) {
      const preview = this.messageContent(last);
      const lastAt = this.toDate(last.timestamp);
      if (preview || lastAt) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt:
              lastAt &&
              (!conversation.lastMessageAt ||
                lastAt > conversation.lastMessageAt)
                ? lastAt
                : conversation.lastMessageAt,
            lastMessagePreview: preview
              ? preview.slice(0, 280)
              : conversation.lastMessagePreview,
            lastMessageSender: last.fromMe ? 'HUMAN' : 'CLIENT',
          },
        });
      }
    }

    return upserted;
  }

  private async runChatSync(businessId: string): Promise<number> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) return 0;
    const ready =
      waConfig.status === 'connected' ||
      waConfig.sessionStatus === 'WORKING';
    if (!ready) return 0;

    let chats: WahaChatOverview[] = [];
    try {
      chats = await this.waha.listChatsOverview(businessId, { limit: 100 });
    } catch (error) {
      this.logger.warn(
        `WAHA chats sync failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 0;
    }

    const selfIds = await this.resolveSelfChatIds(businessId);

    const agent = await this.prisma.agentConfig.findFirst({
      where: { businessId, isDefault: true },
    });

    let upserted = 0;
    for (const chat of chats) {
      const chatId = this.normalizeChatId(chat.id);
      if (!chatId) continue;
      if (this.shouldSkipChat(chatId, chat)) continue;

      const phone =
        this.phoneFromChat(chat, chatId) ||
        (selfIds.has(chatId)
          ? this.waha.phoneFromMeId(waConfig.meId)
          : null);
      const selfChat = selfIds.has(chatId);
      const name = selfChat
        ? 'Yo'
        : chat.name?.trim() || null;
      const contactPhone = selfChat
        ? this.waha.phoneFromMeId(waConfig.meId) || phone
        : phone;
      const last = chat.lastMessage;
      const preview = last ? this.messageContent(last) : null;
      // WhatsApp ordena por _chat.timestamp; lastMessage.timestamp a veces está stale/vacío
      const lastAt =
        this.toDate(chat._chat?.timestamp) ??
        this.toDate(chat.timestamp) ??
        this.toDate(last?.timestamp);
      const lastSender = last
        ? last.fromMe
          ? 'HUMAN'
          : 'CLIENT'
        : null;

      const existing = await this.prisma.conversation.findFirst({
        where: {
          businessId,
          channel: 'WHATSAPP',
          externalId: chatId,
        },
      });

      const metadataBase =
        existing?.metadata && typeof existing.metadata === 'object'
          ? { ...(existing.metadata as object) }
          : {};

      if (existing) {
        // Oculto: solo revivir si hay actividad más nueva que el hide
        if (existing.hiddenAt) {
          if (!lastAt || lastAt <= existing.hiddenAt) {
            continue;
          }
        }
        const reopen =
          existing.status === 'CLOSED' || existing.hiddenAt != null;
        const nextMeta = {
          ...metadataBase,
          wahaChatId: chatId,
          wahaSyncedAt: new Date().toISOString(),
          wahaActivityAt: lastAt?.toISOString() ?? null,
        } as Record<string, unknown>;
        if (reopen) {
          delete nextMeta.hiddenReason;
          delete nextMeta.hiddenAt;
          nextMeta.reopenedAt = new Date().toISOString();
          nextMeta.reopenedReason = 'waha_sync_activity';
        }

        await this.prisma.conversation.update({
          where: { id: existing.id },
          data: {
            externalId: chatId,
            contactName: name ?? existing.contactName,
            contactPhone: contactPhone ?? existing.contactPhone,
            contactAvatarUrl:
              (typeof chat.picture === 'string' && chat.picture
                ? chat.picture
                : null) ?? existing.contactAvatarUrl,
            // No pisar el unread del admin con el del teléfono WAHA
            // Siempre preferir actividad WAHA del chat (no mezclar con updatedAt del sync)
            lastMessageAt: lastAt ?? existing.lastMessageAt,
            lastMessagePreview: preview
              ? preview.slice(0, 280)
              : existing.lastMessagePreview,
            lastMessageSender: lastSender ?? existing.lastMessageSender,
            hiddenAt: null,
            ...(reopen ? { status: 'AI' as const } : {}),
            metadata: nextMeta as object,
          },
        });
      } else {
        const user = await this.upsertUser(
          businessId,
          contactPhone || chatId,
          name ?? undefined,
        );
        await this.prisma.conversation.create({
          data: {
            businessId,
            userId: user.id,
            agentConfigId: agent?.id,
            channel: 'WHATSAPP',
            // Número nuevo: bot activo por defecto (igual que el webhook)
            status: 'AI',
            externalId: chatId,
            contactPhone: contactPhone,
            contactName: name,
            contactAvatarUrl:
              typeof chat.picture === 'string' && chat.picture
                ? chat.picture
                : null,
            unreadCount: chat._chat?.unreadCount ?? 0,
            lastMessageAt: lastAt,
            lastMessagePreview: preview ? preview.slice(0, 280) : null,
            lastMessageSender: lastSender,
            metadata: {
              wahaChatId: chatId,
              wahaSyncedAt: new Date().toISOString(),
              source: 'waha_overview',
              selfChat: selfChat || undefined,
            },
          },
        });
      }
      upserted += 1;
    }

    this.logger.log(
      `WAHA chats sync business=${businessId} upserted=${upserted}/${chats.length}`,
    );
    return upserted;
  }

  private async upsertUser(businessId: string, phone: string, name?: string) {
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

  private normalizeChatId(id: WahaChatOverview['id']): string | null {
    if (!id) return null;
    if (typeof id === 'string') return id;
    if (typeof id === 'object' && id._serialized) return id._serialized;
    if (typeof id === 'object' && id.user && id.server) {
      return `${id.user}@${id.server}`;
    }
    return null;
  }

  private async resolveSelfChatIds(businessId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    const waConfig = await this.config.getForRuntime(businessId);
    if (waConfig?.meId) ids.add(waConfig.meId);
    try {
      const me = await this.waha.getSessionMe(businessId);
      if (me?.id) ids.add(me.id);
      if (me?.lid) ids.add(me.lid);
    } catch {
      // ignore
    }
    return ids;
  }

  private shouldSkipChat(chatId: string, chat: WahaChatOverview): boolean {
    if (chat.isGroup || chatId.includes('@g.us')) return true;
    if (chatId.includes('@newsletter') || chatId.includes('@broadcast')) {
      return true;
    }
    if (chatId === '0@c.us' || chatId.startsWith('status@')) return true;
    return false;
  }

  private phoneFromChat(
    chat: WahaChatOverview,
    chatId: string,
  ): string | null {
    if (chatId.endsWith('@c.us') && !chatId.startsWith('0@')) {
      return chatId.replace(/@c\.us$/i, '');
    }
    const last = chat.lastMessage;
    const candidates = [last?.from, last?.to];
    for (const candidate of candidates) {
      if (
        typeof candidate === 'string' &&
        /@c\.us$/i.test(candidate) &&
        !candidate.startsWith('0@')
      ) {
        return candidate.replace(/@c\.us$/i, '');
      }
    }
    return null;
  }

  private messageExternalId(item: WahaChatMessage): string | null {
    if (!item.id) return null;
    if (typeof item.id === 'string') return item.id;
    return null;
  }

  private messageContent(item: WahaChatMessage): string | null {
    const body = typeof item.body === 'string' ? item.body.trim() : '';
    if (body) return body;
    if (item.hasMedia) return '[Media]';
    if (item.location) return '[Ubicación]';
    if (item.vCards && item.vCards.length > 0) return '[Contacto]';
    return null;
  }

  private toDate(timestamp?: number | null): Date | null {
    if (!timestamp || !Number.isFinite(timestamp)) return null;
    // WAHA usa segundos unix
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private mapAck(ack?: number | string | null, ackName?: string | null) {
    if (ack === 3 || ackName === 'READ') return 'read';
    if (ack === 2 || ackName === 'DEVICE') return 'delivered';
    if (ack === 1 || ackName === 'SERVER') return 'sent';
    return 'sent';
  }
}
