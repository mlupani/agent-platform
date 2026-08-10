import { Injectable } from '@nestjs/common';
import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  OutboundMessage,
} from './channel-adapter.interface';

@Injectable()
export class WebChatChannel implements ChannelAdapter {
  readonly type = 'WEB';

  async receive(payload: unknown): Promise<NormalizedInboundMessage> {
    const data = payload as NormalizedInboundMessage;
    return {
      businessId: data.businessId,
      conversationId: data.conversationId,
      userId: data.userId,
      message: data.message,
      metadata: data.metadata,
    };
  }

  async send(_message: OutboundMessage): Promise<void> {
    // Web chat responde por HTTP/SSE; no hay push externo.
  }
}
