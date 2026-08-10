import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CostService } from './cost.service';
import { CostControlService } from './cost-control.service';

@Module({
  imports: [BusinessesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, CostService, CostControlService],
  exports: [CostService, CostControlService],
})
export class AnalyticsModule {}
