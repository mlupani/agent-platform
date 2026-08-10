import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { IntegrationsService } from './integrations.service';

const createSchema = z.object({
  businessId: z.string().uuid(),
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  secrets: z.record(z.unknown()).optional(),
});

@Controller('admin/integrations')
@UseGuards(ApiKeyGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('business/:businessId')
  list(@Param('businessId') businessId: string) {
    return this.integrations.list(businessId);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createSchema))
    body: z.infer<typeof createSchema>,
  ) {
    return this.integrations.create(body);
  }
}
