import { Injectable } from '@nestjs/common';
import { SocialInboxService } from '../social/social-inbox.service';
import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  OutboundMessage,
} from './channel-adapter.interface';

@Injectable()
export class InstagramChannel implements ChannelAdapter {
  readonly type = 'INSTAGRAM';

  constructor(private readonly inbox: SocialInboxService) {}

  async receive(payload: unknown): Promise<NormalizedInboundMessage> {
    const data = payload as Record<string, unknown>;
    return {
      businessId: String(data.businessId ?? ''),
      conversationId: data.conversationId
        ? String(data.conversationId)
        : undefined,
      externalId: data.externalUserId ? String(data.externalUserId) : undefined,
      message: String(data.message ?? data.text ?? ''),
      metadata: { provider: 'zernio', channel: 'INSTAGRAM', raw: data },
    };
  }

  async send(message: OutboundMessage): Promise<void> {
    await this.inbox.sendForConversation({
      businessId: message.businessId,
      conversationId: message.conversationId,
      body: message.message,
    });
  }
}
