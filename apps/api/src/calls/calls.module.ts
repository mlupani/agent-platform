import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { VapiClient } from './vapi.client';
import { CallConfigService } from './call-config.service';
import { CallLogService } from './call-log.service';
import { VapiBridgeService } from './vapi-bridge.service';
import { CallsAdminController } from './calls-admin.controller';

@Module({
  imports: [PrismaModule, BusinessesModule, RealtimeModule, AiModule],
  controllers: [CallsAdminController],
  providers: [
    SecretsService,
    VapiClient,
    CallConfigService,
    CallLogService,
    VapiBridgeService,
  ],
  exports: [CallConfigService],
})
export class CallsModule {}
