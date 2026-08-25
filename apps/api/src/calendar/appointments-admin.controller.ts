import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { AppointmentsService } from './appointments.service';

const createSchema = z.object({
  serviceId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  startsAt: z.string().datetime({ offset: true }),
  notes: z.string().optional(),
  isTrial: z.boolean().optional(),
});

const cancelSchema = z.object({
  reason: z.string().optional(),
});

const rescheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});

const deleteFeedItemSchema = z.object({
  source: z.enum(['local', 'google']),
  id: z.string().min(1),
});

@Controller('admin/appointments')
@UseGuards(ApiKeyGuard)
export class AppointmentsAdminController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get()
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.list(businessId, { from, to, status });
  }

  @Get('feed')
  async feed(@Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) {
      return { googleConnected: false, items: [] };
    }
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.listFeed(businessId, from, to);
  }

  @Delete('feed-item')
  async deleteFeedItem(
    @Body(new ZodValidationPipe(deleteFeedItemSchema))
    body: z.infer<typeof deleteFeedItemSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.deleteFeedItem(businessId, body.source, body.id);
  }

  @Get('classes')
  async classes(@Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) {
      return { timezone: 'UTC', sessions: [] };
    }
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.listClasses(businessId, from, to);
  }

  @Get('availability')
  async availability(
    @Query('date') date: string,
    @Query('serviceId') serviceId?: string,
    @Query('durationMinutes') durationMinutes?: string,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.checkAvailability({
      businessId,
      date,
      serviceId,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.get(businessId, id);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createSchema))
    body: z.infer<typeof createSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    const business = await this.businesses.getCurrent();
    return this.appointments.create({
      businessId,
      ...body,
      startsAt: new Date(body.startsAt),
      timezone: business.timezone,
    });
  }

  @Patch(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema))
    body: z.infer<typeof cancelSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.cancel(businessId, id, body.reason);
  }

  @Patch(':id/reschedule')
  async reschedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rescheduleSchema))
    body: z.infer<typeof rescheduleSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.reschedule(
      businessId,
      id,
      new Date(body.startsAt),
    );
  }

  @Patch(':id/complete')
  async complete(@Param('id') id: string) {
    const businessId = await this.businesses.getCurrentId();
    return this.appointments.complete(businessId, id);
  }
}
