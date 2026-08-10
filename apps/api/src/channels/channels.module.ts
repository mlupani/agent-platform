import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ChannelRegistry } from './channel.registry';
import { TelegramChannel } from './telegram.channel';
import { WebChatChannel } from './web-chat.channel';
import { WhatsAppChannel } from './whatsapp.channel';

@Module({
  imports: [forwardRef(() => WhatsAppModule)],
  providers: [
    WebChatChannel,
    WhatsAppChannel,
    TelegramChannel,
    ChannelRegistry,
  ],
  exports: [ChannelRegistry, WhatsAppChannel],
})
export class ChannelsModule {}
