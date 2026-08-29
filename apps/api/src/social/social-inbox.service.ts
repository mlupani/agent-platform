import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../ai/agents/agent.service';
import { AudioTranscriptionService } from '../ai/transcription/audio-transcription.service';
import {
  AUDIO_PREFIX,
  formatVoiceMessage,
  isAudioAttachment,
  isPlaceholderCaption,
  parseAttachments,
  type SocialAudioAttachment,
} from '../ai/transcription/inbound-audio';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { LeadsService } from '../leads/leads.service';
import { SocialAccountNotFoundError } from './social.errors';
import { SocialProviderFactory } from './social-provider.factory';
import {
  SOCIAL_INBOX_PLATFORMS,
  conversationChannelForPlatform,
  isSocialInboxPlatform,
  platformForConversationChannel,
  type SocialInboxChannel,
  type SocialInboxPlatform,
} from './social.types';

const PROVIDER = 'zernio';
const MESSAGE_TTL_SECONDS = 86_400;
const PUSH_LIVE_TTL_SECONDS = 15 * 60;
const LIVE_AGENT_MS = 15 * 60_000;
export type SocialInboxSyncMode = 'webhook' | 'poll';

function pushLiveKey(businessId: string) {
  return `zernio:inbox:live:${businessId}`;
}

function lockPrefix(channel: SocialInboxChannel) {
  return channel === 'FACEBOOK' ? 'fb' : 'ig';
}

function userExternalPrefix(channel: SocialInboxChannel) {
  return channel === 'FACEBOOK' ? 'fb' : 'ig';
}

function inboxLabel(channel: SocialInboxChannel) {
  return channel === 'FACEBOOK' ? 'Messenger' : 'Instagram';
}

export interface SocialInboxInbound {
  accountId: string;
  conversationId: string;
  messageId: string;
  text: string;
  fromMe: boolean;
  channel: SocialInboxChannel;
  participantId?: string;
  participantName?: string | null;
  participantUsername?: string | null;
  participantPicture?: string | null;
  attachments?: SocialAudioAttachment[];
}

@Injectable()
export class SocialInboxService {
  private readonly logger = new Logger(SocialInboxService.name);
  private readonly lastChatSync = new Map<string, number>();
  private readonly chatSyncInflight = new Map<string, Promise<number>>();
  private readonly lastMessageSync = new Map<string, number>();
  private readonly messageSyncInflight = new Map<string, Promise<number>>();
  private static readonly CHAT_SYNC_TTL_MS = 12_000;
  private static readonly MESSAGE_SYNC_TTL_MS = 12_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly factory: SocialProviderFactory,
    private readonly agent: AgentService,
    private readonly realtime: RealtimeEventsService,
    private readonly transcription: AudioTranscriptionService,
    private readonly leads: LeadsService,
  ) {}

  async markPushLive(businessId: string): Promise<void> {
    await this.redis.set(
      pushLiveKey(businessId),
      String(Date.now()),
      PUSH_LIVE_TTL_SECONDS,
    );
  }

  async isPushLive(businessId: string): Promise<boolean> {
    const value = await this.redis.get(pushLiveKey(businessId));
    return Boolean(value);
  }

  async inboxSyncMode(businessId: string): Promise<SocialInboxSyncMode> {
    return (await this.isPushLive(businessId)) ? 'webhook' : 'poll';
  }

  async purgeChats(
    businessId: string,
    platform: SocialInboxPlatform = 'instagram',
  ): Promise<number> {
    const channel = conversationChannelForPlatform(platform);
    if (!channel) return 0;
    this.lastChatSync.delete(businessId);
    await this.redis.del(pushLiveKey(businessId));
    const result = await this.prisma.conversation.deleteMany({
      where: { businessId, channel },
    });
    if (result.count > 0) {
      this.logger.log(
        `Purged ${result.count} ${inboxLabel(channel)} conversation(s) for ${businessId}`,
      );
    }
    this.realtime.conversationInboxCleared(businessId, {
      channel,
      deleted: result.count,
    });
    if (channel === 'FACEBOOK') {
      this.realtime.facebookStatusChanged(businessId, {
        status: 'disconnected',
        channel,
      });
    } else {
      this.realtime.instagramStatusChanged(businessId, {
        status: 'disconnected',
        channel,
      });
    }
    return result.count;
  }

  async handleMessageEvent(payload: unknown): Promise<boolean> {
    const inbound = parseInboxEvent(payload);
    if (!inbound) return false;

    const connection = await this.prisma.socialConnection.findUnique({
      where: {
        provider_externalAccountId: {
          provider: PROVIDER,
          externalAccountId: inbound.accountId,
        },
      },
    });
    if (
      !connection ||
      !isSocialInboxPlatform(connection.platform) ||
      connection.status !== 'connected'
    ) {
      return false;
    }

    const channel = conversationChannelForPlatform(connection.platform);
    if (!channel) return false;
    inbound.channel = channel;

    await this.markPushLive(connection.businessId);
    return this.persistAndRoute(connection.businessId, inbound, {
      zernioAccountId: connection.externalAccountId,
      runAgent: !inbound.fromMe && connection.agentEnabled !== false,
    });
  }

  async sendForConversation(input: {
    businessId: string;
    conversationId: string;
    body: string;
  }): Promise<{ externalId?: string }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        businessId: input.businessId,
        channel: { in: ['INSTAGRAM', 'FACEBOOK'] },
      },
    });
    const threadId = conversation?.externalId;
    const platform = platformForConversationChannel(
      conversation?.channel ?? '',
    );
    if (!threadId || !platform) {
      this.logger.warn(
        `Social send skipped: no thread for conversation=${input.conversationId}`,
      );
      return {};
    }

    const connection = await this.prisma.socialConnection.findUnique({
      where: {
        businessId_provider_platform: {
          businessId: input.businessId,
          provider: PROVIDER,
          platform,
        },
      },
    });
    if (!connection || connection.status !== 'connected') {
      throw new SocialAccountNotFoundError(platform);
    }

    const sent = await this.factory.get().sendInboxMessage({
      accountId: connection.externalAccountId,
      conversationId: threadId,
      message: input.body,
    });

    if (sent.externalId) {
      await this.attachOutboundExternalId({
        businessId: input.businessId,
        conversationId: conversation.id,
        externalId: sent.externalId,
      });
    }
    return sent;
  }

  async backfillFromZernio(businessId: string): Promise<number> {
    return this.syncChats(businessId, { force: true });
  }

  async syncChats(
    businessId: string,
    options?: { force?: boolean },
  ): Promise<number> {
    const now = Date.now();
    const last = this.lastChatSync.get(businessId) ?? 0;
    if (!options?.force && now - last < SocialInboxService.CHAT_SYNC_TTL_MS) {
      return 0;
    }
    if (options?.force) this.lastChatSync.delete(businessId);

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

  async syncMessages(
    businessId: string,
    conversationId: string,
    options?: { force?: boolean },
  ): Promise<number> {
    const key = `${businessId}:${conversationId}`;
    const now = Date.now();
    const last = this.lastMessageSync.get(key) ?? 0;
    if (
      !options?.force &&
      now - last < SocialInboxService.MESSAGE_SYNC_TTL_MS
    ) {
      return 0;
    }

    const inflight = this.messageSyncInflight.get(key);
    if (inflight) return inflight;

    const job = this.runMessageSync(businessId, conversationId)
      .then((count) => {
        this.lastMessageSync.set(key, Date.now());
        return count;
      })
      .finally(() => {
        this.messageSyncInflight.delete(key);
      });
    this.messageSyncInflight.set(key, job);
    return job;
  }

  private async runMessageSync(
    businessId: string,
    conversationId: string,
  ): Promise<number> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        businessId,
        channel: { in: ['INSTAGRAM', 'FACEBOOK'] },
      },
    });
    if (!conversation?.externalId) return 0;
    const platform = platformForConversationChannel(conversation.channel);
    const channel = conversationChannelForPlatform(platform ?? '');
    if (!platform || !channel) return 0;

    const connection = await this.prisma.socialConnection.findUnique({
      where: {
        businessId_provider_platform: {
          businessId,
          provider: PROVIDER,
          platform,
        },
      },
    });
    if (!connection || connection.status !== 'connected') return 0;

    let messages;
    try {
      messages = await this.factory.get().listInboxMessages({
        accountId: connection.externalAccountId,
        conversationId: conversation.externalId,
      });
    } catch (error) {
      this.logger.warn(
        `Inbox messages sync failed conv=${conversationId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 0;
    }

    let upserted = 0;
    let latest: {
      text: string;
      fromMe: boolean;
      createdAt?: Date | null;
    } | null = null;
    for (const item of messages) {
      const inbound = this.inboundFromSyncedItem(
        connection.externalAccountId,
        conversation,
        item,
        channel,
      );
      await this.hydrateVoiceText(businessId, inbound);
      latest = {
        text: inbound.text,
        fromMe: inbound.fromMe,
        createdAt: item.createdAt,
      };

      let existing = await this.prisma.message.findFirst({
        where: { businessId, externalId: item.id },
      });
      if (!existing) {
        const sender = item.fromMe ? 'HUMAN' : 'CLIENT';
        existing = await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            businessId,
            role: item.fromMe ? 'assistant' : 'user',
            sender,
            content: inbound.text,
            externalId: item.id,
            status: item.fromMe ? 'sent' : 'received',
            createdAt: item.createdAt ?? undefined,
            metadata: {
              source: 'zernio_sync',
              channel,
            },
          },
        });
        const createdAtMs = item.createdAt?.getTime() ?? Date.now();
        if (Date.now() - createdAtMs < 3 * 60_000) {
          this.realtime.conversationMessageCreated(businessId, {
            conversationId: conversation.id,
            message: existing,
          });
        }
        upserted += 1;
      } else if (
        inbound.text !== existing.content &&
        !isPlaceholderCaption(inbound.text)
      ) {
        existing = await this.prisma.message.update({
          where: { id: existing.id },
          data: { content: inbound.text },
        });
      }

      const createdAtMs =
        item.createdAt?.getTime() ?? existing.createdAt.getTime();
      const isLive = Date.now() - createdAtMs < LIVE_AGENT_MS;
      if (
        isLive &&
        !item.fromMe &&
        existing.sender === 'CLIENT' &&
        connection.agentEnabled !== false
      ) {
        try {
          await this.replyIfNeeded(
            businessId,
            inbound,
            { zernioAccountId: connection.externalAccountId },
            existing,
          );
        } catch (error) {
          this.logger.warn(
            `Inbox agent on sync failed conv=${conversationId}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }

    if (latest) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: latest.createdAt ?? new Date(),
          lastMessagePreview: latest.text.slice(0, 280),
          lastMessageSender: latest.fromMe ? 'HUMAN' : 'CLIENT',
        },
      });
    }
    return upserted;
  }

  private async runChatSync(businessId: string): Promise<number> {
    const connections = await this.prisma.socialConnection.findMany({
      where: {
        businessId,
        provider: PROVIDER,
        platform: { in: [...SOCIAL_INBOX_PLATFORMS] },
        status: 'connected',
      },
    });
    let total = 0;
    for (const connection of connections) {
      total += await this.syncConnectionChats(businessId, connection);
    }
    return total;
  }

  private async syncConnectionChats(
    businessId: string,
    connection: {
      externalAccountId: string;
      zernioProfileId: string;
      platform: string;
    },
  ): Promise<number> {
    const channel = conversationChannelForPlatform(connection.platform);
    if (!channel) return 0;

    try {
      const threads = await this.factory.get().listInboxThreads({
        accountId: connection.externalAccountId,
        profileId: connection.zernioProfileId,
        platform: connection.platform as SocialInboxPlatform,
      });
      let upserted = 0;
      for (const thread of threads) {
        if (!thread.id) continue;
        const conversation = await this.upsertConversation(
          businessId,
          {
            accountId: connection.externalAccountId,
            conversationId: thread.id,
            messageId: `backfill:${thread.id}`,
            text:
              thread.lastMessage?.trim() ||
              `Conversación de ${inboxLabel(channel)}`,
            fromMe: false,
            channel,
            participantId: thread.participantId || thread.id,
            participantName: thread.participantName,
            participantUsername: thread.participantUsername,
            participantPicture: thread.participantPicture,
          },
          {
            zernioAccountId: connection.externalAccountId,
          },
        );

        if (!conversation.hiddenAt) {
          const previousAt = conversation.lastMessageAt?.getTime() ?? 0;
          const threadAt = thread.updatedAt?.getTime() ?? 0;
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: thread.updatedAt ?? new Date(),
              lastMessagePreview:
                (thread.lastMessage ?? '').slice(0, 280) || undefined,
            },
          });
          const previewChanged =
            Boolean(thread.lastMessage) &&
            thread.lastMessage !== conversation.lastMessagePreview;
          if (threadAt > previousAt + 1_000 || previewChanged) {
            const pulled = await this.syncMessages(
              businessId,
              conversation.id,
              {
                force: true,
              },
            );
            if (pulled > 0) {
              this.realtime.conversationUpdated(businessId, {
                conversationId: conversation.id,
                lastMessageAt: thread.updatedAt ?? new Date(),
                lastMessagePreview: thread.lastMessage?.slice(0, 280),
                lastMessageSender: 'CLIENT',
                channel,
              });
            }
          }
        }
        upserted += 1;
      }
      this.logger.log(
        `${inboxLabel(channel)} inbox sync ${businessId}: ${upserted}/${threads.length} hilo(s)`,
      );
      return upserted;
    } catch (error) {
      this.logger.warn(
        `${inboxLabel(channel)} inbox sync ${businessId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 0;
    }
  }

  private async persistAndRoute(
    businessId: string,
    inbound: SocialInboxInbound,
    opts: { zernioAccountId: string; runAgent: boolean },
  ): Promise<boolean> {
    const existing = await this.prisma.message.findFirst({
      where: { businessId, externalId: inbound.messageId },
    });
    if (existing) {
      if (opts.runAgent && !inbound.fromMe) {
        await this.hydrateVoiceText(businessId, inbound);
        if (
          inbound.text !== existing.content &&
          !isPlaceholderCaption(inbound.text)
        ) {
          await this.prisma.message.update({
            where: { id: existing.id },
            data: { content: inbound.text },
          });
        }
        return this.replyIfNeeded(businessId, inbound, opts, existing);
      }
      return false;
    }

    const claimed = await this.redis.acquireLock(
      `${lockPrefix(inbound.channel)}:msgid:${businessId}:${inbound.messageId}`,
      MESSAGE_TTL_SECONDS,
    );
    if (!claimed) return false;

    try {
      await this.hydrateVoiceText(businessId, inbound);
      // No auto-crear alumno: solo vincular si ya existe.
      const existingUser = await this.findExistingSocialUser(businessId, inbound);
      let conversation = await this.upsertConversation(businessId, inbound, {
        userId: existingUser?.id,
        zernioAccountId: opts.zernioAccountId,
      });

      if (conversation.hiddenAt) {
        if (inbound.fromMe) return false;
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
          channel: inbound.channel,
        });
      }

      if (inbound.fromMe) {
        return this.persistFromMe(businessId, conversation.id, inbound);
      }

      if (!opts.runAgent) {
        return this.persistClientWithoutAgent(
          businessId,
          conversation.id,
          inbound,
        );
      }

      const agentLock = await this.redis.acquireLock(
        `${lockPrefix(inbound.channel)}:agent:${businessId}:${inbound.messageId}`,
        120,
      );
      if (!agentLock) {
        return true;
      }

      const previousStatus = conversation.status;
      let result;
      try {
        result = await this.agent.run({
          businessId,
          conversationId: conversation.id,
          userId: conversation.userId ?? existingUser?.id ?? undefined,
          channel: inbound.channel,
          message: inbound.text,
          metadata: {
            contactName: inbound.participantName,
            contactUsername: inbound.participantUsername,
            externalMessageId: inbound.messageId,
            wamid: inbound.messageId,
            channel: inbound.channel,
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
          externalId: inbound.messageId,
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
          afterInbound?.lastMessageAt?.toISOString() ??
          new Date().toISOString(),
        lastMessagePreview: inbound.text.slice(0, 280),
        lastMessageSender: 'CLIENT',
        unreadCount: afterInbound?.unreadCount,
        channel: inbound.channel,
      });

      if (previousStatus === 'AI' && result.status === 'AI' && result.message) {
        if (!existingUser && inbound.participantName) {
          try {
            await this.leads.capture({
              businessId,
              conversationId: conversation.id,
              name: inbound.participantName ?? inbound.participantUsername ?? null,
              source: inbound.channel,
              message: inbound.text?.slice(0, 500) || null,
            });
          } catch {}
        }
        await this.sendAgentOutbound(
          businessId,
          conversation,
          inbound,
          opts,
          result.message,
        );
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
        channel: inbound.channel,
      });
      return true;
    } catch (error) {
      await this.redis.releaseLock(
        `${lockPrefix(inbound.channel)}:msgid:${businessId}:${inbound.messageId}`,
      );
      throw error;
    }
  }

  private inboundFromSyncedItem(
    accountId: string,
    conversation: {
      externalId: string | null;
      contactName: string | null;
      contactUsername: string | null;
      contactAvatarUrl: string | null;
      metadata: unknown;
    },
    item: {
      id: string;
      text: string;
      fromMe: boolean;
      attachments?: SocialAudioAttachment[];
    },
    channel: SocialInboxChannel,
  ): SocialInboxInbound {
    const meta =
      conversation.metadata && typeof conversation.metadata === 'object'
        ? (conversation.metadata as Record<string, unknown>)
        : {};
    const participantId =
      (typeof meta.externalUserId === 'string' && meta.externalUserId) ||
      conversation.externalId ||
      item.id;
    return {
      accountId,
      conversationId: conversation.externalId || item.id,
      messageId: item.id,
      text: item.text,
      fromMe: item.fromMe,
      channel,
      participantId,
      participantName: conversation.contactName,
      participantUsername: conversation.contactUsername,
      participantPicture: conversation.contactAvatarUrl,
      attachments: item.attachments,
    };
  }

  private async replyIfNeeded(
    businessId: string,
    inbound: SocialInboxInbound,
    opts: { zernioAccountId: string },
    existing: {
      id: string;
      conversationId: string;
      createdAt: Date;
      sender?: string | null;
    },
  ): Promise<boolean> {
    if (existing.sender && existing.sender !== 'CLIENT') return false;

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: existing.conversationId, businessId, channel: inbound.channel },
    });
    if (
      !conversation ||
      conversation.hiddenAt ||
      conversation.status !== 'AI'
    ) {
      return false;
    }

    const hasReply = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        businessId,
        sender: { in: ['AI', 'HUMAN'] },
        createdAt: { gte: existing.createdAt },
      },
    });
    if (hasReply) return false;

    const claimed = await this.redis.acquireLock(
      `${lockPrefix(inbound.channel)}:agent:${businessId}:${inbound.messageId}`,
      120,
    );
    if (!claimed) return false;

    let userId = conversation.userId;
    if (!userId) {
      const existing = await this.findExistingSocialUser(businessId, inbound);
      if (existing) userId = existing.id;
      else userId = undefined as unknown as string;
    }

    const result = await this.agent.run({
      businessId,
      conversationId: conversation.id,
      userId,
      channel: inbound.channel,
      message: inbound.text,
      metadata: {
        contactName: inbound.participantName,
        contactUsername: inbound.participantUsername,
        externalMessageId: inbound.messageId,
        wamid: inbound.messageId,
        channel: inbound.channel,
      },
    });

    if (result.status === 'AI' && result.message) {
      await this.sendAgentOutbound(
        businessId,
        conversation,
        inbound,
        opts,
        result.message,
      );
    } else if (result.status !== conversation.status) {
      this.realtime.conversationBotStatusChanged(businessId, {
        conversationId: conversation.id,
        status: result.status,
        botActive: false,
      });
    }
    this.realtime.conversationUpdated(businessId, {
      conversationId: conversation.id,
      status: result.status,
      channel: inbound.channel,
    });
    return true;
  }

  private async sendAgentOutbound(
    businessId: string,
    conversation: { id: string; externalId: string | null },
    inbound: SocialInboxInbound,
    opts: { zernioAccountId: string },
    message: string,
  ): Promise<void> {
    try {
      const sent = await this.factory.get().sendInboxMessage({
        accountId: opts.zernioAccountId,
        conversationId: conversation.externalId || inbound.conversationId,
        message,
      });
      if (sent.externalId) {
        await this.attachOutboundExternalId({
          businessId,
          conversationId: conversation.id,
          externalId: sent.externalId,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to send ${inboxLabel(inbound.channel)} AI reply: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async persistFromMe(
    businessId: string,
    conversationId: string,
    inbound: SocialInboxInbound,
  ): Promise<boolean> {
    const recentAi = await this.prisma.message.findFirst({
      where: {
        conversationId,
        businessId,
        sender: 'AI',
        content: inbound.text,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recentAi) {
      if (!recentAi.externalId) {
        await this.prisma.message.update({
          where: { id: recentAi.id },
          data: { externalId: inbound.messageId, status: 'sent' },
        });
      }
      return false;
    }

    const recentHuman = await this.prisma.message.findFirst({
      where: {
        conversationId,
        businessId,
        sender: 'HUMAN',
        content: inbound.text,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recentHuman) {
      if (!recentHuman.externalId) {
        await this.prisma.message.update({
          where: { id: recentHuman.id },
          data: { externalId: inbound.messageId, status: 'sent' },
        });
      }
      return false;
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        businessId,
        role: 'assistant',
        sender: 'HUMAN',
        content: inbound.text,
        externalId: inbound.messageId,
        status: 'sent',
        metadata: {
          source: 'zernio_from_me',
          channel: inbound.channel,
        },
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: inbound.text.slice(0, 280),
        lastMessageSender: 'HUMAN',
      },
    });
    this.realtime.conversationMessageCreated(businessId, {
      conversationId,
      message,
    });
    this.realtime.conversationUpdated(businessId, {
      conversationId,
      lastMessageAt: message.createdAt,
      lastMessagePreview: inbound.text.slice(0, 280),
      lastMessageSender: 'HUMAN',
      channel: inbound.channel,
    });
    return true;
  }

  private async persistClientWithoutAgent(
    businessId: string,
    conversationId: string,
    inbound: SocialInboxInbound,
  ): Promise<boolean> {
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        businessId,
        role: 'user',
        sender: 'CLIENT',
        content: inbound.text,
        externalId: inbound.messageId,
        status: 'received',
        metadata: {
          source: 'zernio_backfill',
          channel: inbound.channel,
          externalUsername: inbound.participantUsername,
        },
      },
    });
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: inbound.text.slice(0, 280),
        lastMessageSender: 'CLIENT',
        unreadCount: { increment: 1 },
      },
    });
    this.realtime.conversationMessageCreated(businessId, {
      conversationId,
      message,
    });
    this.realtime.conversationUpdated(businessId, {
      conversationId,
      lastMessageAt: message.createdAt,
      lastMessagePreview: inbound.text.slice(0, 280),
      lastMessageSender: 'CLIENT',
      unreadCount: updated.unreadCount,
      channel: inbound.channel,
    });
    return true;
  }

  private async attachOutboundExternalId(input: {
    businessId: string;
    conversationId: string;
    externalId: string;
  }) {
    await this.redis.acquireLock(
      `social:msgid:${input.businessId}:${input.externalId}`,
      MESSAGE_TTL_SECONDS,
    );
    const lastOutbound = await this.prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        businessId: input.businessId,
        sender: { in: ['AI', 'HUMAN'] },
        externalId: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastOutbound) return;
    try {
      const updated = await this.prisma.message.update({
        where: { id: lastOutbound.id },
        data: { externalId: input.externalId, status: 'sent' },
      });
      this.realtime.conversationMessageCreated(input.businessId, {
        conversationId: input.conversationId,
        message: updated,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar externalId social: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private async findExistingSocialUser(businessId: string, inbound: SocialInboxInbound) {
    const externalId = `${userExternalPrefix(inbound.channel)}:${inbound.participantId ?? inbound.conversationId}`;
    const existing = await this.prisma.user.findFirst({
      where: { businessId, externalId },
    });
    if (existing && inbound.participantName && existing.name !== inbound.participantName) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { name: inbound.participantName },
      });
    }
    return existing;
  }

  // Deprecated: no auto-crear alumno por inbox social. Mantener por compatibilidad pero no crea User.
  private async upsertUser(businessId: string, inbound: SocialInboxInbound) {
    const found = await this.findExistingSocialUser(businessId, inbound);
    return found ?? (null as unknown as { id: string });
  }

  private async upsertConversation(
    businessId: string,
    inbound: SocialInboxInbound,
    opts?: { userId?: string; zernioAccountId?: string },
  ) {
    const resolvedUserId =
      opts?.userId ?? (await this.findExistingSocialUser(businessId, inbound))?.id ?? null;
    const userId = resolvedUserId;
    const existing = await this.prisma.conversation.findFirst({
      where: {
        businessId,
        channel: inbound.channel,
        externalId: inbound.conversationId,
      },
    });
    const contactName =
      inbound.participantName ?? inbound.participantUsername ?? undefined;
    if (existing) {
      if (existing.hiddenAt) return existing;
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          userId,
          contactName,
          contactUsername: inbound.participantUsername ?? undefined,
          contactAvatarUrl: inbound.participantPicture ?? undefined,
        },
      });
    }
    return this.prisma.conversation.create({
      data: {
        businessId,
        userId,
        channel: inbound.channel,
        status: 'AI',
        externalId: inbound.conversationId,
        contactName: contactName ?? null,
        contactUsername: inbound.participantUsername ?? null,
        contactAvatarUrl: inbound.participantPicture ?? null,
        metadata: {
          channel: inbound.channel,
          provider: PROVIDER,
          zernioAccountId: opts?.zernioAccountId,
          externalUserId: inbound.participantId,
        },
      },
    });
  }

  private async hydrateVoiceText(
    businessId: string,
    inbound: SocialInboxInbound,
  ): Promise<void> {
    if (inbound.text.includes(`${AUDIO_PREFIX} `)) return;
    const audio = (inbound.attachments ?? []).find(isAudioAttachment);
    if (!audio) return;

    let transcript: string | null = null;
    if (audio.url) {
      const language = await this.businessLanguage(businessId);
      transcript = await this.transcription.transcribeFromUrl(audio.url, {
        mimeType: audio.mimeType,
        language,
      });
    }
    inbound.text = formatVoiceMessage({
      transcript,
      caption: inbound.text,
    });
  }

  private async businessLanguage(businessId: string): Promise<string | null> {
    const row = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { language: true },
    });
    return row?.language ?? 'es';
  }
}

export function parseInboxEvent(payload: unknown): SocialInboxInbound | null {
  const event = asRecord(payload);
  if (!event) return null;
  const type = stringOf(event.event) ?? stringOf(event.type);
  if (type !== 'message.received' && type !== 'message.sent') return null;

  const account =
    asRecord(event.account) ??
    asRecord(asRecord(event.data)?.account) ??
    asRecord(event.data);
  const message =
    asRecord(event.message) ??
    asRecord(asRecord(event.data)?.message) ??
    asRecord(event.data);
  const conversation =
    asRecord(event.conversation) ??
    asRecord(message?.conversation) ??
    asRecord(asRecord(event.data)?.conversation);

  const platform =
    stringOf(account?.platform) ??
    stringOf(message?.platform) ??
    stringOf(conversation?.platform);
  if (platform && !isSocialInboxPlatform(platform)) return null;

  const accountId =
    stringOf(account?.accountId) ??
    stringOf(account?._id) ??
    stringOf(account?.id);
  const conversationId =
    stringOf(message?.conversationId) ?? stringOf(conversation?.id);
  const messageId =
    stringOf(message?.id) ??
    stringOf(message?.messageId) ??
    stringOf(message?.platformMessageId);
  if (!accountId || !conversationId || !messageId) return null;

  const sender = asRecord(message?.sender);
  const participant = asRecord(conversation?.participant) ?? sender;
  const parsedAttachments = parseAttachments(message?.attachments);
  const hasAttachments = parsedAttachments.length > 0;
  const text =
    stringOf(message?.text) ??
    stringOf(message?.message) ??
    (hasAttachments ? '[Adjunto]' : undefined);
  if (!text) return null;

  const direction = stringOf(message?.direction);
  const fromMe =
    type === 'message.sent' ||
    direction === 'outgoing' ||
    direction === 'outbound';

  return {
    accountId,
    conversationId,
    messageId,
    text,
    fromMe,
    channel: conversationChannelForPlatform(platform ?? 'instagram') ?? 'INSTAGRAM',
    participantId:
      stringOf(participant?.id) ??
      stringOf(conversation?.participantId) ??
      stringOf(sender?.id),
    participantName:
      stringOf(participant?.name) ??
      stringOf(conversation?.participantName) ??
      stringOf(sender?.name) ??
      null,
    participantUsername:
      stringOf(participant?.username) ?? stringOf(sender?.username) ?? null,
    participantPicture:
      stringOf(participant?.picture) ??
      stringOf(participant?.profilePicture) ??
      stringOf(conversation?.participantPicture) ??
      stringOf(sender?.picture) ??
      null,
    attachments: parsedAttachments,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
