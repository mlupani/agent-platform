import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { InstagramAdminController } from './instagram-admin.controller';
import { InstagramConfigService } from './instagram-config.service';
import { InstagramInboxSyncService } from './instagram-inbox.sync';
import { InstagramMessagingProvider } from './instagram.messaging-provider';
import { InstagramService } from './instagram.service';

@Module({
  imports: [BusinessesModule, RealtimeModule, forwardRef(() => AiModule)],
  controllers: [InstagramAdminController],
  providers: [
    SecretsService,
    InstagramConfigService,
    InstagramService,
    InstagramMessagingProvider,
    InstagramInboxSyncService,
  ],
  exports: [
    InstagramConfigService,
    InstagramService,
    InstagramMessagingProvider,
  ],
})
export class InstagramModule {}
