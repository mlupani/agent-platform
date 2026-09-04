import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Conversation } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { WahaWhatsAppProvider } from './providers/waha.whatsapp-provider';
import type {
  WahaChatMessage,
  WahaChatOverview,
} from './providers/waha.whatsapp-provider';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { WhatsAppConfigService } from './whatsapp-config.service';
import { LeadsService } from '../leads/leads.service';
import {
  formatSharedContactMessage,
  parseSharedContact,
} from '../ai/transcription/parse-shared-contact';
import {
  alternateWhatsAppExternalIds,
  isWhatsAppLid,
  isWhatsAppLegacyPhoneId,
  phoneFromDisplayName,
  phoneFromJid,
  phonesLikelySame,
  pickPreferredWhatsAppConversation,
  resolveWhatsAppExternalId,
} from './whatsapp-chat-id.util';

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
    private readonly realtime: RealtimeEventsService,
    private readonly leads: LeadsService,
  ) {}

  async purgeChats(businessId: string): Promise<number> {
    this.lastChatSync.delete(businessId);
    const result = await this.prisma.conversation.deleteMany({
      where: { businessId, channel: 'WHATSAPP' },
    });
    if (result.count > 0) {
      this.logger.log(
        `Purged ${result.count} WhatsApp conversation(s) for ${businessId}`,
      );
    }
    this.realtime.conversationInboxCleared(businessId, {
      channel: 'WHATSAPP',
      deleted: result.count,
    });
    return result.count;
  }

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
    let messages: WahaChatMessage[];
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
      waConfig.status === 'connected' || waConfig.sessionStatus === 'WORKING';
    if (!ready) return 0;

    let chats: WahaChatOverview[];
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
    const ownerPhone =
      this.waha.phoneFromMeId(waConfig.meId) ||
      waConfig.displayPhoneNumber ||
      null;

    const agent = await this.prisma.agentConfig.findFirst({
      where: { businessId, isDefault: true },
    });

    let upserted = 0;
    for (const chat of chats) {
      const chatId = this.normalizeChatId(chat.id);
      if (!chatId) continue;
      if (this.shouldSkipChat(chatId, chat)) continue;

      const selfChat = selfIds.has(chatId);
      const phone =
        this.phoneFromChat(chat, chatId, ownerPhone) ||
        (selfChat ? ownerPhone : null);
      const name = selfChat ? 'Yo' : chat.name?.trim() || null;
      const contactPhone = selfChat ? ownerPhone || phone : phone;
      const last = chat.lastMessage;
      const preview = last ? this.messageContent(last) : null;
      // WhatsApp ordena por _chat.timestamp; lastMessage.timestamp a veces está stale/vacío
      const lastAt =
        this.toDate(chat._chat?.timestamp) ??
        this.toDate(chat.timestamp) ??
        this.toDate(last?.timestamp);
      const lastSender = last ? (last.fromMe ? 'HUMAN' : 'CLIENT') : null;

      const existing = await this.findExistingConversation(
        businessId,
        chatId,
        contactPhone,
        name,
        ownerPhone,
      );

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
            externalId: resolveWhatsAppExternalId(existing.externalId, chatId),
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
            metadata: nextMeta as Prisma.InputJsonValue,
          },
        });

        await this.hideLegacyPhoneDuplicates(businessId, {
          id: existing.id,
          contactName: name ?? existing.contactName,
          contactPhone: contactPhone ?? existing.contactPhone,
          externalId: resolveWhatsAppExternalId(existing.externalId, chatId),
        });
      } else {
        let existingUser: { id: string } | null = null;
        if (contactPhone) {
          existingUser = await this.prisma.user.findFirst({
            where: { businessId, phone: contactPhone },
            select: { id: true },
          });
        } else if (name) {
          existingUser = null;
        }
        await this.prisma.conversation.create({
          data: {
            businessId,
            userId: existingUser?.id ?? null,
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
              // no se creó User automáticamente
              autoUserSkipped: !existingUser ? true : undefined,
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

  // Deprecated: no auto-crear alumnos por sync de chats
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
    return null as unknown as { id: string };
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

  private async findExistingConversation(
    businessId: string,
    chatId: string,
    phone: string | null,
    contactName: string | null,
    ownerPhone: string | null,
  ): Promise<Conversation | null> {
    const candidates: Conversation[] = [];
    const push = (row: Conversation | null | undefined) => {
      if (!row) return;
      if (candidates.some((c) => c.id === row.id)) return;
      candidates.push(row);
    };

    const byExternal = await this.prisma.conversation.findMany({
      where: {
        businessId,
        channel: 'WHATSAPP',
        externalId: { in: alternateWhatsAppExternalIds(chatId) },
      },
      orderBy: [{ hiddenAt: 'asc' }, { updatedAt: 'desc' }],
      take: 10,
    });
    byExternal.forEach(push);

    if (phone && phone !== ownerPhone) {
      const byPhone = await this.prisma.conversation.findMany({
        where: {
          businessId,
          channel: 'WHATSAPP',
          OR: [
            { contactPhone: phone },
            { externalId: { in: alternateWhatsAppExternalIds(phone) } },
          ],
        },
        orderBy: [{ hiddenAt: 'asc' }, { updatedAt: 'desc' }],
        take: 10,
      });
      for (const row of byPhone) {
        const stored = row.contactPhone || phoneFromJid(row.externalId);
        if (!stored || phonesLikelySame(stored, phone)) push(row);
      }

      const legacy = await this.prisma.conversation.findMany({
        where: {
          businessId,
          channel: 'WHATSAPP',
          externalId: { endsWith: '@c.us' },
        },
        orderBy: [{ hiddenAt: 'asc' }, { updatedAt: 'desc' }],
        take: 200,
      });
      for (const row of legacy) {
        const legacyPhone = phoneFromJid(row.externalId);
        if (legacyPhone && phonesLikelySame(legacyPhone, phone)) push(row);
      }
    }

    const namePhone = phoneFromDisplayName(contactName);
    if (
      namePhone &&
      namePhone !== ownerPhone &&
      (!phone || phonesLikelySame(namePhone, phone))
    ) {
      const byNamePhone = await this.prisma.conversation.findMany({
        where: {
          businessId,
          channel: 'WHATSAPP',
          OR: [
            { contactPhone: namePhone },
            { externalId: { in: alternateWhatsAppExternalIds(namePhone) } },
          ],
        },
        orderBy: [{ hiddenAt: 'asc' }, { updatedAt: 'desc' }],
        take: 10,
      });
      byNamePhone.forEach(push);
    }

    if (contactName && contactName !== 'Yo') {
      const byName = await this.prisma.conversation.findMany({
        where: {
          businessId,
          channel: 'WHATSAPP',
          contactName,
        },
        orderBy: [{ hiddenAt: 'asc' }, { updatedAt: 'desc' }],
        take: 10,
      });
      byName.forEach(push);
    }

    // Si solo encontramos @c.us, buscar @lid con el mismo nombre
    for (const row of [...candidates]) {
      if (
        isWhatsAppLegacyPhoneId(row.externalId) &&
        row.contactName &&
        row.contactName !== 'Yo'
      ) {
        const lids = await this.prisma.conversation.findMany({
          where: {
            businessId,
            channel: 'WHATSAPP',
            contactName: row.contactName,
            externalId: { contains: '@lid' },
          },
          take: 5,
        });
        lids.forEach(push);
      }
    }

    return pickPreferredWhatsAppConversation(candidates, chatId);
  }

  private async hideLegacyPhoneDuplicates(
    businessId: string,
    keeper: {
      id: string;
      contactName: string | null;
      contactPhone: string | null;
      externalId: string | null;
    },
  ) {
    if (!isWhatsAppLid(keeper.externalId)) return;
    const or: Array<Record<string, unknown>> = [];
    if (keeper.contactName && keeper.contactName !== 'Yo') {
      or.push({ contactName: keeper.contactName });
    }
    if (keeper.contactPhone) {
      or.push({ contactPhone: keeper.contactPhone });
      or.push({
        externalId: { in: alternateWhatsAppExternalIds(keeper.contactPhone) },
      });
    }
    if (!or.length) return;

    await this.prisma.conversation.updateMany({
      where: {
        businessId,
        channel: 'WHATSAPP',
        id: { not: keeper.id },
        hiddenAt: null,
        externalId: { endsWith: '@c.us' },
        OR: or,
      },
      data: {
        hiddenAt: new Date(),
        status: 'CLOSED',
      },
    });
  }

  private phoneFromChat(
    chat: WahaChatOverview,
    chatId: string,
    ownerPhone?: string | null,
  ): string | null {
    const fromChatId = phoneFromJid(chatId);
    if (fromChatId && fromChatId !== ownerPhone) return fromChatId;

    const last = chat.lastMessage;
    if (last) {
      // fromMe → el teléfono del contacto está en `to`, no en `from` (yo)
      const counterpart = last.fromMe ? last.to : last.from;
      const fromCounterpart = phoneFromJid(counterpart);
      if (fromCounterpart && fromCounterpart !== ownerPhone) {
        return fromCounterpart;
      }
      const other = last.fromMe ? last.from : last.to;
      const fromOther = phoneFromJid(other);
      if (fromOther && fromOther !== ownerPhone) return fromOther;
    }

    const fromName = phoneFromDisplayName(chat.name);
    if (fromName && fromName !== ownerPhone) return fromName;
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
    if (item.vCards && item.vCards.length > 0) {
      return formatSharedContactMessage(parseSharedContact(item.vCards));
    }
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
