import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { WhatsAppProviderFactory } from '../whatsapp/providers/whatsapp-provider.factory';
import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  OutboundMessage,
} from './channel-adapter.interface';

@Injectable()
export class WhatsAppChannel implements ChannelAdapter {
  readonly type = 'WHATSAPP';
  private readonly logger = new Logger(WhatsAppChannel.name);

  constructor(
    private readonly providers: WhatsAppProviderFactory,
    private readonly prisma: PrismaService,
  ) {}

  async receive(payload: unknown): Promise<NormalizedInboundMessage> {
    const data = payload as Record<string, unknown>;
    return {
      businessId: String(data.businessId ?? ''),
      conversationId: data.conversationId
        ? String(data.conversationId)
        : undefined,
      externalId: data.from ? String(data.from) : undefined,
      message: String(data.message ?? data.text ?? ''),
      metadata: { provider: 'whatsapp', raw: data },
    };
  }

  async send(message: OutboundMessage): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: message.conversationId,
        businessId: message.businessId,
      },
    });
    // Preferir chatId WAHA (puede ser @lid / @c.us); el teléfono solo como fallback
    const external = conversation?.externalId ?? null;
    const to =
      (external && external.includes('@') ? external : null) ||
      conversation?.contactPhone ||
      external ||
      (message.metadata?.to ? String(message.metadata.to) : undefined);

    if (!to) {
      this.logger.warn(
        `WhatsApp send skipped: no phone for conversation=${message.conversationId}`,
      );
      return;
    }

    const provider = await this.providers.getForBusiness(message.businessId);
    const result = await provider.sendText({
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
          // Si el wamid ya existe (ack/sync), no fallar el envío
          this.logger.warn(
            `No se pudo guardar externalId del mensaje: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }
  }
}
