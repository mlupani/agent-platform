import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AdminRoleGuard } from '../common/guards/admin-role.guard';
import { AnalyticsService } from './analytics.service';
import { SpendService } from './spend.service';

@Controller('admin/analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly spend: SpendService,
  ) {}

  @Get('overview')
  overview() {
    return this.analytics.overview();
  }

  @Get('dashboard')
  dashboard(@Query('month') month?: string) {
    return this.analytics.dashboard(month);
  }

  @Get('spend')
  @UseGuards(AdminRoleGuard)
  spendReport(@Query('month') month?: string) {
    return this.spend.report(month);
  }

  @Get('businesses/:id')
  byBusiness(@Param('id') id: string) {
    return this.analytics.byBusiness(id);
  }
}
