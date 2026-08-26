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
import { ClientsService } from './clients.service';

const trimOrNull = (value: unknown) => {
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
};

const clientSchema = z.object({
  name: z.preprocess(trimOrNull, z.string().max(120).nullable().optional()),
  email: z.preprocess(
    trimOrNull,
    z.union([z.string().email().max(200), z.null()]).optional(),
  ),
  phone: z.preprocess(trimOrNull, z.string().max(40).nullable().optional()),
  notes: z.preprocess(trimOrNull, z.string().max(2000).nullable().optional()),
  statusSlug: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

@Controller('admin/clients')
@UseGuards(ApiKeyGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get('statuses')
  statuses() {
    return this.clients.listStatuses();
  }

  @Get()
  list(
    @Query('status') status?: string,
    @Query('name') name?: string,
    @Query('search') search?: string,
  ) {
    return this.clients.list(status, name ?? search);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(clientSchema))
    body: z.infer<typeof clientSchema>,
  ) {
    return this.clients.create(body);
  }

  @Get(':id/appointments')
  appointments(@Param('id') id: string) {
    return this.clients.getAppointments(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.clients.get(id);
  }

  @Post(':id/whatsapp')
  openWhatsApp(@Param('id') id: string) {
    return this.clients.openWhatsApp(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(clientSchema))
    body: z.infer<typeof clientSchema>,
  ) {
    return this.clients.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clients.remove(id);
  }
}
