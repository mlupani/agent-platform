import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentService } from '../ai/agents/agent.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WebChatConfigService } from './web-chat-config.service';
import type {
  WebChatConversationResult,
  WebChatMessageResult,
} from './web-chat.types';

@Injectable()
export class WebChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
    private readonly config: WebChatConfigService,
  ) {}

  async handleMessage(input: {
    businessId: string;
    message: string;
    conversationId?: string;
    source?: string;
    visitorName?: string;
    origin?: string;
  }): Promise<WebChatMessageResult> {
    const source = input.source?.trim() || 'website';
    const conversationId = await this.resolveConversationId(input, source);

    const result = await this.agent.run({
      businessId: input.businessId,
      conversationId,
      message: input.message,
      channel: 'WEB',
      metadata: {
        source,
        origin: input.origin,
      },
    });

    await this.config.touchLastUsed(input.businessId);

    return {
      conversationId: result.conversationId,
      message: result.message,
      status: result.status,
    };
  }

  async getConversation(
    businessId: string,
    conversationId: string,
  ): Promise<WebChatConversationResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        businessId,
        channel: 'WEB',
      },
      include: {
        messages: {
          where: { sender: { in: ['CLIENT', 'AI', 'HUMAN'] } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sender: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      conversationId: conversation.id,
      channel: 'WEB',
      status: conversation.status,
      messages: conversation.messages.map((item) => ({
        id: item.id,
        sender: item.sender,
        role: item.role,
        content: item.content,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private async resolveConversationId(
    input: {
      businessId: string;
      conversationId?: string;
      visitorName?: string;
      origin?: string;
    },
    source: string,
  ): Promise<string> {
    if (input.conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: {
          id: input.conversationId,
          businessId: input.businessId,
          channel: 'WEB',
        },
      });
      if (!existing) {
        throw new NotFoundException('Conversation not found');
      }

      const visitorName = input.visitorName?.trim();
      if (visitorName && existing.contactName !== visitorName) {
        await this.prisma.conversation.update({
          where: { id: existing.id },
          data: { contactName: visitorName },
        });
      }
      return existing.id;
    }

    const created = await this.prisma.conversation.create({
      data: {
        businessId: input.businessId,
        channel: 'WEB',
        status: 'AI',
        contactName: input.visitorName?.trim() || 'Visitante web',
        metadata: {
          source,
          origin: input.origin,
        },
      },
    });
    return created.id;
  }
}
