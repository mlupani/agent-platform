import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { VapiClient } from './vapi.client';
import { CallConfigService } from './call-config.service';
import { CallsAdminController } from './calls-admin.controller';

@Module({
  imports: [PrismaModule, BusinessesModule],
  controllers: [CallsAdminController],
  providers: [SecretsService, VapiClient, CallConfigService],
  exports: [CallConfigService],
})
export class CallsModule {}
