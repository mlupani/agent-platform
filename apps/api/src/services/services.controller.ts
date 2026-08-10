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
import {
  createServiceSchema,
  updateServiceSchema,
} from '../businesses/business.schemas';
import { ServicesService } from './services.service';

@Controller('admin/services')
@UseGuards(ApiKeyGuard)
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@Query('enabledOnly') enabledOnly?: string) {
    return this.services.list(enabledOnly === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.services.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createServiceSchema))
    body: z.infer<typeof createServiceSchema>,
  ) {
    return this.services.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateServiceSchema))
    body: z.infer<typeof updateServiceSchema>,
  ) {
    return this.services.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.services.remove(id);
  }
}
