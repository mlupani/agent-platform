import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ZernioSocialProvider } from './providers/zernio.social-provider';
import { SocialAdminController } from './social-admin.controller';
import { SocialInboxService } from './social-inbox.service';
import { SocialOAuthController } from './social-oauth.controller';
import { SocialProviderFactory } from './social-provider.factory';
import { SOCIAL_PROVIDERS } from './social-provider.interface';
import { SocialPublishingService } from './social-publishing.service';
import { SocialWebhookController } from './social-webhook.controller';
import { SocialWebhookService } from './social-webhook.service';

@Module({
  imports: [BusinessesModule, RealtimeModule, forwardRef(() => AiModule)],
  controllers: [
    SocialAdminController,
    SocialOAuthController,
    SocialWebhookController,
  ],
  providers: [
    ZernioSocialProvider,
    {
      provide: SOCIAL_PROVIDERS,
      useFactory: (zernio: ZernioSocialProvider) => [zernio],
      inject: [ZernioSocialProvider],
    },
    SocialProviderFactory,
    SocialPublishingService,
    SocialInboxService,
    SocialWebhookService,
  ],
  exports: [SocialPublishingService, SocialProviderFactory, SocialInboxService],
})
export class SocialModule {}
