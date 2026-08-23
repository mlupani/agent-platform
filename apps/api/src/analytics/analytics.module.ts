import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CostService } from './cost.service';
import { CostControlService } from './cost-control.service';
import { SpendService } from './spend.service';

@Module({
  imports: [BusinessesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, CostService, CostControlService, SpendService],
  exports: [CostService, CostControlService],
})
export class AnalyticsModule {}
