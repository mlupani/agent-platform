import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClassTemplatesService } from './class-templates.service';

const upsertSchema = z.object({
  serviceId: z.string().uuid(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  capacity: z.union([z.coerce.number().int().min(1).max(80), z.null()]).optional(),
});

const patchSchema = z.object({
  serviceId: z.string().uuid().optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  capacity: z.union([z.coerce.number().int().min(1).max(80), z.null()]).optional(),
});

@Controller('admin/class-templates')
@UseGuards(ApiKeyGuard)
export class ClassTemplatesAdminController {
  constructor(private readonly templates: ClassTemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    return this.templates.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchSchema))
    body: z.infer<typeof patchSchema>,
  ) {
    return this.templates.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templates.remove(id);
  }
}
