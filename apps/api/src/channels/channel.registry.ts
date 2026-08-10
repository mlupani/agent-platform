import { Injectable } from '@nestjs/common';
import type { ChannelAdapter } from './channel-adapter.interface';
import { TelegramChannel } from './telegram.channel';
import { WebChatChannel } from './web-chat.channel';
import { WhatsAppChannel } from './whatsapp.channel';

@Injectable()
export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelAdapter>();

  constructor(
    web: WebChatChannel,
    whatsapp: WhatsAppChannel,
    telegram: TelegramChannel,
  ) {
    this.channels.set(web.type, web);
    this.channels.set(whatsapp.type, whatsapp);
    this.channels.set(telegram.type, telegram);
  }

  get(type: string): ChannelAdapter | undefined {
    return this.channels.get(type.toUpperCase());
  }

  list(): ChannelAdapter[] {
    return [...this.channels.values()];
  }
}
