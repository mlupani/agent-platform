import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { ConversationStatus, MessageSender } from '../common/constants';
import { BusinessesService } from '../businesses/businesses.service';
import { ChannelRegistry } from '../channels/channel.registry';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { WahaConversationsSyncService } from '../whatsapp/waha-conversations.sync';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly channels: ChannelRegistry,
    private readonly realtime: RealtimeEventsService,
    private readonly wahaSync: WahaConversationsSyncService,
  ) {}

  async list(status?: string) {
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

    const conversations = await this.prisma.conversation.findMany({
      where: {
        businessId,
        ...(status ? { status } : {}),
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

  async get(id: string, options?: { markRead?: boolean }) {
    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, businessId },
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
    }

    const refreshed = await this.prisma.conversation.findFirst({
      where: { id, businessId },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        business: { select: { id: true, name: true } },
      },
    });
    if (!refreshed) throw new NotFoundException('Conversation not found');

    if (options?.markRead && refreshed.unreadCount > 0) {
      await this.prisma.conversation.update({
        where: { id: refreshed.id },
        data: { unreadCount: 0 },
      });
      refreshed.unreadCount = 0;
    }

    return {
      ...refreshed,
      displayName: this.displayName(refreshed),
      botActive: refreshed.status === 'AI',
      needsAttention:
        refreshed.status === 'WAITING_HUMAN' || refreshed.status === 'HUMAN',
    };
  }

  async pause(id: string) {
    return this.updateStatus(id, 'HUMAN', { reason: 'operator_paused' });
  }

  async resume(id: string) {
    return this.updateStatus(id, 'AI', { reason: 'operator_resumed' });
  }

  async close(id: string) {
    return this.updateStatus(id, 'CLOSED', { reason: 'operator_closed' });
  }

  async updateStatus(
    id: string,
    status: ConversationStatus,
    meta?: { reason?: string },
  ) {
    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, businessId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

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

  async sendHumanMessage(id: string, content: string) {
    const text = content.trim();
    if (!text) throw new BadRequestException('El mensaje no puede estar vacío');

    const businessId = await this.businesses.getCurrentId();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, businessId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
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
        unreadCount: options.incrementUnread
          ? { increment: 1 }
          : undefined,
        status: options.forceStatus,
        contactName: options.contactName ?? undefined,
        contactPhone: options.contactPhone ?? undefined,
      },
    });
  }

  private displayName(conversation: {
    contactName?: string | null;
    contactPhone?: string | null;
    externalId?: string | null;
    user?: { name?: string | null; phone?: string | null } | null;
    id: string;
  }): string {
    return (
      conversation.contactName ||
      conversation.user?.name ||
      conversation.contactPhone ||
      conversation.user?.phone ||
      conversation.externalId ||
      `Chat ${conversation.id.slice(0, 8)}`
    );
  }
}
