import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AnalyticsService } from './analytics.service';

@Controller('admin/analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview() {
    return this.analytics.overview();
  }

  @Get('dashboard')
  dashboard() {
    return this.analytics.dashboard();
  }

  @Get('businesses/:id')
  byBusiness(@Param('id') id: string) {
    return this.analytics.byBusiness(id);
  }
}
