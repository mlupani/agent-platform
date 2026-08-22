import { Module, forwardRef } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { ChannelsModule } from '../channels/channels.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    BusinessesModule,
    ChannelsModule,
    RealtimeModule,
    forwardRef(() => WhatsAppModule),
    forwardRef(() => SocialModule),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
