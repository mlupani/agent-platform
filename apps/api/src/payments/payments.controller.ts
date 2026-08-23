import {
  BadRequestException,
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
import { PaymentsService } from './payments.service';

const trimOrNull = (value: unknown) => {
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
};

const paymentSchema = z.object({
  userId: z.string().uuid(),
  amount: z.coerce.number().positive().max(99_999_999.99),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.preprocess(trimOrNull, z.string().max(2000).nullable().optional()),
  serviceId: z.preprocess(
    trimOrNull,
    z.string().uuid().nullable().optional(),
  ),
  cover: z.enum(['pack', 'session']).optional(),
});

const paymentUpdateSchema = paymentSchema.partial();
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

@Controller('admin/payments')
@UseGuards(ApiKeyGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('stats')
  stats(
    @Query('clientId') clientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.assertListQuery(clientId, from, to);
    return this.payments.stats({ userId: clientId, from, to });
  }

  @Get()
  list(
    @Query('clientId') clientId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.assertListQuery(clientId, from, to);
    if (serviceId && !z.string().uuid().safeParse(serviceId).success) {
      throw new BadRequestException('Servicio no válido');
    }
    return this.payments.list({ userId: clientId, serviceId, from, to });
  }

  @Post('passes/:id/use')
  useSession(@Param('id') id: string) {
    return this.payments.useSession(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(paymentSchema))
    body: z.infer<typeof paymentSchema>,
  ) {
    return this.payments.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(paymentUpdateSchema))
    body: z.infer<typeof paymentUpdateSchema>,
  ) {
    return this.payments.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.payments.remove(id);
  }

  private assertListQuery(clientId?: string, from?: string, to?: string) {
    if (clientId && !z.string().uuid().safeParse(clientId).success) {
      throw new BadRequestException('Cliente no válido');
    }
    if (from && !daySchema.safeParse(from).success) {
      throw new BadRequestException('La fecha de inicio no es válida.');
    }
    if (to && !daySchema.safeParse(to).success) {
      throw new BadRequestException('La fecha de fin no es válida.');
    }
  }
}
