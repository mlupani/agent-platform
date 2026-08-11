import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { InstagramMessagingProvider } from '../instagram/instagram.messaging-provider';
import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  OutboundMessage,
} from './channel-adapter.interface';

@Injectable()
export class InstagramChannel implements ChannelAdapter {
  readonly type = 'INSTAGRAM';
  private readonly logger = new Logger(InstagramChannel.name);

  constructor(
    private readonly provider: InstagramMessagingProvider,
    private readonly prisma: PrismaService,
  ) {}

  async receive(payload: unknown): Promise<NormalizedInboundMessage> {
    const data = payload as Record<string, unknown>;
    return {
      businessId: String(data.businessId ?? ''),
      conversationId: data.conversationId
        ? String(data.conversationId)
        : undefined,
      externalId: data.externalUserId
        ? String(data.externalUserId)
        : undefined,
      message: String(data.message ?? data.text ?? ''),
      metadata: { provider: 'instagram', channel: 'INSTAGRAM', raw: data },
    };
  }

  async send(message: OutboundMessage): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: message.conversationId,
        businessId: message.businessId,
      },
    });

    const to = conversation?.externalId;
    if (!to) {
      this.logger.warn(
        `Instagram send skipped: no thread for conversation=${message.conversationId}`,
      );
      return;
    }

    const result = await this.provider.sendText({
      businessId: message.businessId,
      to,
      body: message.message,
    });

    if (result.externalId) {
      const externalId = String(result.externalId);
      const lastOutbound = await this.prisma.message.findFirst({
        where: {
          conversationId: message.conversationId,
          businessId: message.businessId,
          sender: { in: ['AI', 'HUMAN'] },
          externalId: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (lastOutbound) {
        try {
          await this.prisma.message.update({
            where: { id: lastOutbound.id },
            data: {
              externalId,
              status: 'sent',
            },
          });
        } catch (error) {
          this.logger.warn(
            `No se pudo guardar externalId Instagram: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }
  }
}
