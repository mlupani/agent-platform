import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

export interface PaymentInput {
  userId: string;
  amount: number;
  paidAt: string;
  notes?: string | null;
}

export interface PaymentListFilters {
  userId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  async list(filters: PaymentListFilters = {}) {
    const businessId = await this.businesses.getCurrentId();
    const from = filters.from ? this.requireDayBound(filters.from, 'start') : undefined;
    const to = filters.to ? this.requireDayBound(filters.to, 'end') : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'La fecha de inicio no puede ser posterior a la de fin.',
      );
    }
    const rows = await this.prisma.payment.findMany({
      where: {
        businessId,
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(from || to
          ? {
              paidAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: {
        user: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((row) => this.toPayment(row));
  }

  async create(input: PaymentInput) {
    const businessId = await this.businesses.getCurrentId();
    const client = await this.requireClient(businessId, input.userId);
    const amount = this.requireAmount(input.amount);
    const paidAt = this.requirePaidAt(input.paidAt);
    const created = await this.prisma.payment.create({
      data: {
        businessId,
        userId: client.id,
        amount: new Prisma.Decimal(amount),
        paidAt,
        notes: input.notes?.trim() || null,
      },
      include: {
        user: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });
    return this.toPayment(created);
  }

  async update(id: string, input: Partial<PaymentInput>) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.payment.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Pago no encontrado');

    const client =
      input.userId !== undefined
        ? await this.requireClient(businessId, input.userId)
        : null;
    const amount =
      input.amount !== undefined ? this.requireAmount(input.amount) : undefined;
    const paidAt =
      input.paidAt !== undefined ? this.requirePaidAt(input.paidAt) : undefined;

    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        ...(client ? { userId: client.id } : {}),
        ...(amount !== undefined ? { amount: new Prisma.Decimal(amount) } : {}),
        ...(paidAt ? { paidAt } : {}),
        ...(input.notes !== undefined
          ? { notes: input.notes?.trim() || null }
          : {}),
      },
      include: {
        user: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });
    return this.toPayment(updated);
  }

  async remove(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.payment.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Pago no encontrado');
    await this.prisma.payment.delete({ where: { id } });
    return { id };
  }

  private async requireClient(businessId: string, userId: string) {
    const client = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
    });
    if (!client) throw new BadRequestException('Cliente no encontrado');
    return client;
  }

  private requireAmount(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('El importe tiene que ser mayor a 0.');
    }
    return Math.round(amount * 100) / 100;
  }

  private requirePaidAt(value: string) {
    return this.requireDayBound(value, 'noon');
  }

  private requireDayBound(value: string, bound: 'start' | 'end' | 'noon') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('La fecha no es válida.');
    }
    const time =
      bound === 'start'
        ? 'T00:00:00.000Z'
        : bound === 'end'
          ? 'T23:59:59.999Z'
          : 'T12:00:00.000Z';
    const date = new Date(`${value}${time}`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('La fecha no es válida.');
    }
    return date;
  }

  private toPayment(row: {
    id: string;
    amount: Prisma.Decimal;
    paidAt: Date;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
    };
  }) {
    return {
      id: row.id,
      amount: Number(row.amount.toString()),
      paidAt: row.paidAt.toISOString().slice(0, 10),
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      client: row.user,
    };
  }
}
