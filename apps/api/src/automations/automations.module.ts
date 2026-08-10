import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { N8nService } from './n8n.service';

@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, N8nService],
  exports: [AutomationsService, N8nService],
})
export class AutomationsModule {}
