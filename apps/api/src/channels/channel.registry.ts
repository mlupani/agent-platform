import { Injectable } from '@nestjs/common';
import type { ChannelAdapter } from './channel-adapter.interface';
import { FacebookChannel } from './facebook.channel';
import { InstagramChannel } from './instagram.channel';
import { TelegramChannel } from './telegram.channel';
import { WebChatChannel } from './web-chat.channel';
import { WhatsAppChannel } from './whatsapp.channel';

@Injectable()
export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelAdapter>();

  constructor(
    web: WebChatChannel,
    whatsapp: WhatsAppChannel,
    instagram: InstagramChannel,
    facebook: FacebookChannel,
    telegram: TelegramChannel,
  ) {
    this.channels.set(web.type, web);
    this.channels.set(whatsapp.type, whatsapp);
    this.channels.set(instagram.type, instagram);
    this.channels.set(facebook.type, facebook);
    this.channels.set(telegram.type, telegram);
  }

  get(type: string): ChannelAdapter | undefined {
    return this.channels.get(type.toUpperCase());
  }

  list(): ChannelAdapter[] {
    return [...this.channels.values()];
  }
}
