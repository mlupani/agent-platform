import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LeadsService } from './leads.service';

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
  channel: z
    .enum(['MANUAL', 'WEB', 'WHATSAPP', 'INSTAGRAM'])
    .optional()
    .default('MANUAL'),
});

@Controller('admin/leads')
@UseGuards(ApiKeyGuard)
export class LeadsAdminController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list() {
    return this.leads.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createManualSchema))
    body: z.infer<typeof createManualSchema>,
  ) {
    return this.leads.createManual(body);
  }
}
