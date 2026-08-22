import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { ConversationStatus, MessageSender } from '../common/constants';
import { ADMIN_ONLY_CONVERSATION_CHANNELS } from '../common/constants';
import type { AdminRole } from '../auth/auth.constants';
import { BusinessesService } from '../businesses/businesses.service';
import { ChannelRegistry } from '../channels/channel.registry';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { SocialInboxService } from '../social/social-inbox.service';
import { WahaConversationsSyncService } from '../whatsapp/waha-conversations.sync';

interface RoleOptions {
  role?: AdminRole;
  pull?: boolean;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly channels: ChannelRegistry,
    private readonly realtime: RealtimeEventsService,
    private readonly wahaSync: WahaConversationsSyncService,
    private readonly socialInbox: SocialInboxService,
  ) {}

  async list(status?: string, options?: RoleOptions) {
    const businessId = await this.businesses.getCurrentId();
    try {
      await this.wahaSync.syncChats(businessId);
    } catch (error) {
      this.logger.warn(
        `WAHA list sync skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
    try {
      if (options?.pull === false) {
        if (!(await this.socialInbox.isPushLive(businessId))) {
          await this.socialInbox.syncChats(businessId);
        }
      } else {
        await this.socialInbox.syncChats(businessId, { force: true });
      }
    } catch (error) {
      this.logger.warn(
        `Instagram list sync skipped: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    const channelFilter = await this.inboxChannelFilter(
      businessId,
      options?.role,
    );
    const conversations = await this.prisma.conversation.findMany({
      where: {
        businessId,
        hiddenAt: null,
        ...(status ? { status } : {}),
        ...channelFilter,
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }],
      take: 200,
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        _count: { select: { messages: true } },
      },
    });

    return conversations.map((conversation) => ({
      ...conversation,
      displayName: this.displayName(conversation),
      botActive: conversation.status === 'AI',
      needsAttention:
        conversation.status === 'WAITING_HUMAN' ||
        conversation.status === 'HUMAN',
    }));
  }

  async get(id: string, options?: { markRead?: boolean; role?: AdminRole }) {
    const businessId = await this.businesses.getCurrentId();
    const channelFilter = await this.inboxChannelFilter(
      businessId,
      options?.role,
    );
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        businessId,
        hiddenAt: null,
        ...channelFilter,
      },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        business: { select: { id: true, name: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.channel === 'WHATSAPP') {
      try {
        await this.wahaSync.syncMessages(businessId, conversation.id);
      } catch (error) {
        this.logger.warn(
          `WAHA messages sync skipped: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    } else if (conversation.channel === 'INSTAGRAM') {
      try {
        await this.socialInbox.syncMessages(businessId, conversation.id, {
          force: true,
        });
      } catch (error) {
        this.logger.warn(
          `Instagram messages sync skipped: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    const refreshed = await this.prisma.conversation.findFirst({
      where: {
        id,
        businessId,
        hiddenAt: null,
        ...channelFilter,
      },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        business: { select: { id: true, name: true } },
      },
    });
    if (!refreshed) throw new NotFoundException('Conversation not found');

    if (options?.markRead) {
      await this.markReadById(businessId, refreshed.id, refreshed);
    }

    return {
      ...refreshed,
      displayName: this.displayName(refreshed),
      botActive: refreshed.status === 'AI',
      needsAttention:
        refreshed.status === 'WAITING_HUMAN' || refreshed.status === 'HUMAN',
      inboxSync:
        refreshed.channel === 'INSTAGRAM'
          ? await this.socialInbox.inboxSyncMode(businessId)
          : undefined,
    };
  }

  async markRead(id: string, options?: RoleOptions) {
    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.assertVisible(
      id,
      businessId,
      options?.role,
    );
    await this.markReadById(businessId, conversation.id, conversation);
    return {
      id: conversation.id,
      unreadCount: 0,
    };
  }

  private async markReadById(
    businessId: string,
    conversationId: string,
    conversation: {
      unreadCount: number;
      status: string;
      lastMessageAt: Date | null;
      lastMessagePreview: string | null;
      lastMessageSender: string | null;
    },
  ) {
    if (conversation.unreadCount <= 0) return;
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
    conversation.unreadCount = 0;
    this.realtime.conversationUpdated(businessId, {
      conversationId,
      unreadCount: 0,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSender: conversation.lastMessageSender,
    });
  }

  async pause(id: string, options?: RoleOptions) {
    return this.updateStatus(id, 'HUMAN', {
      reason: 'operator_paused',
      role: options?.role,
    });
  }

  async resume(id: string, options?: RoleOptions) {
    return this.updateStatus(id, 'AI', {
      reason: 'operator_resumed',
      role: options?.role,
    });
  }

  async close(id: string, options?: RoleOptions) {
    return this.updateStatus(id, 'CLOSED', {
      reason: 'operator_closed',
      role: options?.role,
    });
  }

  /** Oculta la conversación de la bandeja. El sync no la revive salvo mensaje nuevo del cliente. */
  async hide(id: string, options?: RoleOptions) {
    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.assertVisible(
      id,
      businessId,
      options?.role,
    );

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        hiddenAt: new Date(),
        status: 'CLOSED',
        unreadCount: 0,
        metadata: {
          ...((conversation.metadata &&
          typeof conversation.metadata === 'object'
            ? conversation.metadata
            : {}) as object),
          hiddenReason: 'operator_deleted',
          hiddenAt: new Date().toISOString(),
        },
      },
    });

    this.realtime.conversationUpdated(businessId, {
      conversationId: updated.id,
      status: updated.status,
      hidden: true,
    });

    return { ok: true, id: updated.id };
  }

  async updateStatus(
    id: string,
    status: ConversationStatus,
    meta?: { reason?: string; role?: AdminRole },
  ) {
    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.assertVisible(id, businessId, meta?.role);

    const metadata =
      conversation.metadata && typeof conversation.metadata === 'object'
        ? { ...(conversation.metadata as object) }
        : {};

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status,
        metadata: {
          ...metadata,
          statusChangedAt: new Date().toISOString(),
          statusReason: meta?.reason,
        },
      },
    });

    this.realtime.conversationBotStatusChanged(businessId, {
      conversationId: updated.id,
      status: updated.status,
      botActive: updated.status === 'AI',
      reason: meta?.reason,
    });
    this.realtime.conversationUpdated(businessId, {
      conversationId: updated.id,
      status: updated.status,
      unreadCount: updated.unreadCount,
    });

    return updated;
  }

  async sendHumanMessage(id: string, content: string, options?: RoleOptions) {
    const text = content.trim();
    if (!text) throw new BadRequestException('El mensaje no puede estar vacío');

    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.assertVisible(
      id,
      businessId,
      options?.role,
    );
    if (conversation.status === 'CLOSED') {
      throw new BadRequestException('La conversación está cerrada');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        businessId,
        role: 'assistant',
        sender: 'HUMAN',
        content: text,
        status: 'sent',
        metadata: { source: 'dashboard' },
      },
    });

    await this.touchConversation(conversation.id, {
      preview: text,
      sender: 'HUMAN',
      incrementUnread: false,
      forceStatus:
        conversation.status === 'AI' || conversation.status === 'WAITING_HUMAN'
          ? 'HUMAN'
          : undefined,
    });

    const channel = this.channels.get(conversation.channel);
    if (channel) {
      await channel.send({
        businessId,
        conversationId: conversation.id,
        message: text,
        metadata: { sender: 'HUMAN' },
      });
    }

    this.realtime.conversationMessageCreated(businessId, {
      conversationId: conversation.id,
      message,
    });
    this.realtime.conversationUpdated(businessId, {
      conversationId: conversation.id,
      status: 'HUMAN',
    });
    this.realtime.conversationBotStatusChanged(businessId, {
      conversationId: conversation.id,
      status: 'HUMAN',
      botActive: false,
    });

    return message;
  }

  async touchConversation(
    conversationId: string,
    options: {
      preview: string;
      sender: MessageSender;
      incrementUnread?: boolean;
      forceStatus?: ConversationStatus;
      contactName?: string;
      contactPhone?: string;
    },
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return;

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: options.preview.slice(0, 280),
        lastMessageSender: options.sender,
        unreadCount: options.incrementUnread ? { increment: 1 } : undefined,
        status: options.forceStatus,
        contactName: options.contactName ?? undefined,
        contactPhone: options.contactPhone ?? undefined,
      },
    });
  }

  private async assertVisible(
    id: string,
    businessId: string,
    role?: AdminRole,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        businessId,
        hiddenAt: null,
        ...(await this.inboxChannelFilter(businessId, role)),
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  /** Solo canales con la integración conectada. WEB queda (no se reimporta). */
  private async inboxChannelFilter(businessId: string, role?: AdminRole) {
    const [wa, ig] = await Promise.all([
      this.prisma.whatsAppConfig.findUnique({
        where: { businessId },
        select: { status: true, sessionStatus: true },
      }),
      this.prisma.socialConnection.findUnique({
        where: {
          businessId_provider_platform: {
            businessId,
            provider: 'zernio',
            platform: 'instagram',
          },
        },
        select: { status: true },
      }),
    ]);

    const channels: string[] = ['WEB'];
    if (role === 'ADMIN') {
      channels.push(...ADMIN_ONLY_CONVERSATION_CHANNELS);
    }
    if (wa?.status === 'connected' || wa?.sessionStatus === 'WORKING') {
      channels.push('WHATSAPP');
    }
    if (ig?.status === 'connected') {
      channels.push('INSTAGRAM');
    }
    return { channel: { in: channels } };
  }

  private displayName(conversation: {
    contactName?: string | null;
    contactUsername?: string | null;
    contactPhone?: string | null;
    externalId?: string | null;
    user?: { name?: string | null; phone?: string | null } | null;
    id: string;
  }): string {
    const username = conversation.contactUsername
      ? conversation.contactUsername.startsWith('@')
        ? conversation.contactUsername
        : `@${conversation.contactUsername}`
      : null;
    return (
      conversation.contactName ||
      conversation.user?.name ||
      username ||
      conversation.contactPhone ||
      conversation.user?.phone ||
      conversation.externalId ||
      `Chat ${conversation.id.slice(0, 8)}`
    );
  }
}
