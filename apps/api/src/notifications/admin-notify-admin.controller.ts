import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import {
  ADMIN_NOTIFY_EVENTS,
  MAX_ADMIN_NOTIFY_EMAILS,
} from './admin-notify.constants';
import { AdminNotifyService } from './admin-notify.service';

const upsertSchema = z.object({
  enabled: z.boolean().optional(),
  emails: z.array(z.string().max(200)).max(MAX_ADMIN_NOTIFY_EMAILS).optional(),
  email: z
    .union([z.string().max(200), z.literal(''), z.null()])
    .optional(),
  events: z.array(z.enum(ADMIN_NOTIFY_EVENTS)).min(1).max(8).optional(),
});

@Controller('admin/notify')
@UseGuards(ApiKeyGuard)
export class AdminNotifyAdminController {
  constructor(
    private readonly notify: AdminNotifyService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get()
  async get() {
    const businessId = await this.businesses.getCurrentId();
    return this.notify.getPublic(businessId);
  }

  @Put()
  async upsert(
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    const emails =
      body.emails !== undefined || body.email !== undefined
        ? [
            ...(body.emails ?? []),
            ...(body.email && body.email !== '' ? [body.email] : []),
          ]
        : undefined;
    return this.notify.upsert(businessId, {
      enabled: body.enabled,
      emails,
      events: body.events,
    });
  }
}
