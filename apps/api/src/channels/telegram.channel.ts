import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  OutboundMessage,
} from './channel-adapter.interface';

@Injectable()
export class TelegramChannel implements ChannelAdapter {
  readonly type = 'TELEGRAM';
  private readonly logger = new Logger(TelegramChannel.name);

  async receive(payload: unknown): Promise<NormalizedInboundMessage> {
    const data = payload as Record<string, unknown>;
    return {
      businessId: String(data.businessId ?? ''),
      conversationId: data.conversationId ? String(data.conversationId) : undefined,
      externalId: data.chatId ? String(data.chatId) : undefined,
      message: String(data.message ?? data.text ?? ''),
      metadata: { provider: 'telegram', raw: data },
    };
  }

  async send(message: OutboundMessage): Promise<void> {
    this.logger.log(
      `Telegram adapter stub: conversation=${message.conversationId}. Configure the Telegram integration to enable delivery.`,
    );
  }
}
