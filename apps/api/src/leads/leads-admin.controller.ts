import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { LeadFollowUpSenderService } from './lead-follow-up-sender.service';
import { LeadFollowUpService } from './lead-follow-up.service';
import { LeadLifecycleService } from './lead-lifecycle.service';
import { LeadsService } from './leads.service';
import { LEAD_STATUSES, SEND_MODES, CONVERSION_MODES } from './lead.constants';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const createManualSchema = z.object({
  name: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().email().max(200).optional(),
  ),
  phone: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
  message: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(2000).optional(),
  ),
  interest: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  channel: z
    .enum(['MANUAL', 'WEB', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK'])
    .optional()
    .default('MANUAL'),
});

const updateSchema = z.object({
  name: z.preprocess(emptyToUndefined, z.string().trim().max(120).nullable().optional()),
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().email().max(200).nullable().optional(),
  ),
  phone: z.preprocess(emptyToUndefined, z.string().trim().max(40).nullable().optional()),
  message: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(2000).nullable().optional(),
  ),
  interest: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(200).nullable().optional(),
  ),
  objections: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(500).nullable().optional(),
  ),
  status: z.enum(LEAD_STATUSES).optional(),
});

const lostSchema = z.object({
  reason: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
});

const followUpSchema = z.object({
  scheduledAt: z.string().datetime(),
  objective: z.string().trim().min(1).max(80),
  objectiveNote: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(500).optional(),
  ),
});

const rescheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

const sendFollowUpSchema = z.object({
  message: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
});

const lifecycleSchema = z.object({
  followUpEnabled: z.boolean().optional(),
  conversionMode: z.enum(CONVERSION_MODES).optional(),
  conversionTriggers: z.array(z.string()).optional(),
  followUpDelaysHours: z.array(z.number().int().min(1).max(720)).max(6).optional(),
  maxAttempts: z.number().int().min(1).max(8).optional(),
  generateWithAi: z.boolean().optional(),
  sendMode: z.enum(SEND_MODES).optional(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().max(80).nullable().optional(),
  preferredChannel: z.string().max(40).optional(),
  askForMissingContact: z.boolean().optional(),
  convertedClientStatusSlug: z.string().max(40).optional(),
  trialClientStatusSlug: z.string().max(40).optional(),
});

@Controller('admin/leads')
@UseGuards(ApiKeyGuard)
export class LeadsAdminController {
  constructor(
    private readonly leads: LeadsService,
    private readonly followUps: LeadFollowUpService,
    private readonly lifecycle: LeadLifecycleService,
    private readonly sender: LeadFollowUpSenderService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get('lifecycle')
  async getLifecycle() {
    const businessId = await this.businesses.getCurrentId();
    return this.lifecycle.getPublic(businessId);
  }

  @Put('lifecycle')
  async upsertLifecycle(
    @Body(new ZodValidationPipe(lifecycleSchema))
    body: z.infer<typeof lifecycleSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.lifecycle.upsert(businessId, body);
  }

  @Get()
  list(
    @Query('status') status?: string,
    @Query('contactable') contactable?: string,
    @Query('search') search?: string,
    @Query('name') name?: string,
  ) {
    return this.leads.list({
      status: status || undefined,
      contactable:
        contactable === 'true' ? true : contactable === 'false' ? false : undefined,
      search: search || name || undefined,
    });
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createManualSchema))
    body: z.infer<typeof createManualSchema>,
  ) {
    return this.leads.createManual(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.leads.getById(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.leads.update(id, body);
  }

  @Post(':id/convert')
  convert(@Param('id') id: string) {
    return this.leads.convert(id);
  }

  @Post(':id/lost')
  lost(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(lostSchema)) body: z.infer<typeof lostSchema>,
  ) {
    return this.leads.markLost(id, body.reason);
  }

  @Post(':id/follow-ups')
  async createFollowUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(followUpSchema))
    body: z.infer<typeof followUpSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.followUps.create({
      businessId,
      leadId: id,
      source: 'manual',
      objective: body.objective,
      objectiveNote: body.objectiveNote,
      scheduledAt: new Date(body.scheduledAt),
      actor: 'admin',
    });
  }

  @Patch(':id/follow-ups/:followUpId')
  async reschedule(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body(new ZodValidationPipe(rescheduleSchema))
    body: z.infer<typeof rescheduleSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.followUps.reschedule(
      businessId,
      id,
      followUpId,
      new Date(body.scheduledAt),
    );
  }

  @Post(':id/follow-ups/:followUpId/cancel')
  async cancelFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.followUps.cancel(businessId, id, followUpId, 'manual', 'admin');
  }

  @Post(':id/follow-ups/:followUpId/send')
  async sendFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body(new ZodValidationPipe(sendFollowUpSchema))
    body: z.infer<typeof sendFollowUpSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    const followUp = await this.followUps.getOne(businessId, id, followUpId);
    if (!['pending', 'review', 'failed'].includes(followUp.status)) {
      throw new BadRequestException('Ese seguimiento ya no se puede enviar.');
    }
    const message = body.message || followUp.draftMessage;
    if (!message) {
      throw new BadRequestException(
        'No hay mensaje para enviar. Generá o escribí un borrador.',
      );
    }
    await this.sender.send(followUpId, message);
    return this.leads.getById(id);
  }
}
