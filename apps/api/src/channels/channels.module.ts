import { Module, forwardRef } from '@nestjs/common';
import { SocialModule } from '../social/social.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ChannelRegistry } from './channel.registry';
import { InstagramChannel } from './instagram.channel';
import { TelegramChannel } from './telegram.channel';
import { WebChatChannel } from './web-chat.channel';
import { WhatsAppChannel } from './whatsapp.channel';

@Module({
  imports: [forwardRef(() => WhatsAppModule), forwardRef(() => SocialModule)],
  providers: [
    WebChatChannel,
    WhatsAppChannel,
    InstagramChannel,
    TelegramChannel,
    ChannelRegistry,
  ],
  exports: [ChannelRegistry, WhatsAppChannel, InstagramChannel],
})
export class ChannelsModule {}
