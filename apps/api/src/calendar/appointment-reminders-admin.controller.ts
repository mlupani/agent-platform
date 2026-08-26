import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { AppointmentReminderService } from './appointment-reminder.service';

const upsertSchema = z.object({
  enabled: z.boolean().optional(),
  hoursBefore: z.number().int().min(1).max(24).optional(),
  channels: z
    .array(z.enum(['whatsapp', 'email', 'instagram', 'facebook']))
    .min(1)
    .max(4)
    .optional(),
  message: z.string().max(2000).nullable().optional(),
});

@Controller('admin/appointment-reminders')
@UseGuards(ApiKeyGuard)
export class AppointmentRemindersAdminController {
  constructor(
    private readonly reminders: AppointmentReminderService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get()
  async get() {
    const businessId = await this.businesses.getCurrentId();
    return this.reminders.getPublic(businessId);
  }

  @Put()
  async upsert(
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.reminders.upsert(businessId, body);
  }
}
