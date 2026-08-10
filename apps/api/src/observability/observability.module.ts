import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';

@Module({
  imports: [BusinessesModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService],
  exports: [ExecutionsService],
})
export class ObservabilityModule {}
