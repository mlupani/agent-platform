import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AutomationsService } from './automations.service';

const createSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  webhookUrl: z.string().url(),
  metadata: z.record(z.unknown()).optional(),
});

@Controller('admin/automations')
@UseGuards(ApiKeyGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('business/:businessId')
  list(@Param('businessId') businessId: string) {
    return this.automations.list(businessId);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createSchema))
    body: z.infer<typeof createSchema>,
  ) {
    return this.automations.create(body);
  }
}
