import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { LeadsModule } from '../leads/leads.module';
import { WhatsAppAdminController } from './whatsapp-admin.controller';
import { WhatsAppConfigService } from './whatsapp-config.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WahaConversationsSyncService } from './waha-conversations.sync';
import { MetaCloudWhatsAppProvider } from './providers/meta-cloud.whatsapp-provider';
import { WahaWhatsAppProvider } from './providers/waha.whatsapp-provider';
import { WahaMessagingProvider } from './providers/waha.messaging-provider';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';

@Module({
  imports: [BusinessesModule, RealtimeModule, forwardRef(() => AiModule), forwardRef(() => LeadsModule)],
  controllers: [WhatsAppWebhookController, WhatsAppAdminController],
  providers: [
    SecretsService,
    WhatsAppConfigService,
    WahaWhatsAppProvider,
    WahaMessagingProvider,
    MetaCloudWhatsAppProvider,
    WhatsAppProviderFactory,
    WhatsAppWebhookService,
    WahaConversationsSyncService,
  ],
  exports: [
    WhatsAppConfigService,
    WhatsAppProviderFactory,
    WahaWhatsAppProvider,
    WahaMessagingProvider,
    WahaConversationsSyncService,
  ],
})
export class WhatsAppModule {}
