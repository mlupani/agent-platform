import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { businessTypes } from '../common/constants';
import {
  replaceHoursSchema,
  updateAssistantSchema,
  updateBusinessProfileSchema,
} from './business.schemas';
import { BusinessesService } from './businesses.service';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: z.enum(businessTypes).optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  systemPrompt: z.string().max(8000).optional(),
  personality: z.string().max(2000).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  tools: z.array(z.string()).optional(),
  openingHours: z.record(z.unknown()).optional(),
  defaultMessages: z.record(z.string()).optional(),
  rules: z.record(z.unknown()).optional(),
});

@Controller('admin')
@UseGuards(ApiKeyGuard)
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  /** Single-business: negocio del deployment. */
  @Get('business')
  getCurrent() {
    return this.businesses.getCurrent();
  }

  @Patch('business')
  updateProfile(
    @Body(new ZodValidationPipe(updateBusinessProfileSchema))
    body: z.infer<typeof updateBusinessProfileSchema>,
  ) {
    return this.businesses.updateProfile(body);
  }

  @Patch('business/assistant')
  updateAssistant(
    @Body(new ZodValidationPipe(updateAssistantSchema))
    body: z.infer<typeof updateAssistantSchema>,
  ) {
    return this.businesses.updateAssistant(body);
  }

  @Get('business/hours')
  getHours() {
    return this.businesses.getHours();
  }

  @Put('business/hours')
  replaceHours(
    @Body(new ZodValidationPipe(replaceHoursSchema))
    body: z.infer<typeof replaceHoursSchema>,
  ) {
    return this.businesses.replaceHours(body.hours);
  }

  /** Compat: listado (0–1 negocios en single-tenant). */
  @Get('businesses')
  list() {
    return this.businesses.list();
  }

  @Get('businesses/:id')
  get(@Param('id') id: string) {
    return this.businesses.get(id);
  }

  @Post('businesses')
  create(
    @Body(new ZodValidationPipe(createSchema))
    body: z.infer<typeof createSchema>,
  ) {
    return this.businesses.create(body);
  }

  @Patch('businesses/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBusinessProfileSchema))
    body: z.infer<typeof updateBusinessProfileSchema>,
  ) {
    return this.businesses.update(id, body);
  }
}
