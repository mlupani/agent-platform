import { Module } from '@nestjs/common';
import { SecretsService } from '../common/crypto/secrets.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, SecretsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
