import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

export type PaymentCover = 'pack' | 'session';

export interface PaymentInput {
  userId: string;
  amount: number;
  paidAt: string;
  notes?: string | null;
  serviceId?: string | null;
  cover?: PaymentCover;
}

export interface PaymentListFilters {
  userId?: string;
  serviceId?: string;
  from?: string;
  to?: string;
}

const paymentInclude = {
  user: {
    select: { id: true, name: true, phone: true, email: true },
  },
  service: {
    select: { id: true, name: true, sessionCount: true, price: true },
  },
  pass: {
    select: {
      id: true,
      sessionCount: true,
      sessionsPaid: true,
      sessionsUsed: true,
    },
  },
} as const;

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
        ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
        ...(from || to
          ? {
              paidAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: paymentInclude,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((row) => this.toPayment(row));
  }

  async stats(filters: PaymentListFilters = {}) {
    const businessId = await this.businesses.getCurrentId();
    const from = filters.from ? this.requireDayBound(filters.from, 'start') : undefined;
    const to = filters.to ? this.requireDayBound(filters.to, 'end') : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'La fecha de inicio no puede ser posterior a la de fin.',
      );
    }
    const grouped = await this.prisma.payment.groupBy({
      by: ['serviceId'],
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
      _count: { id: true },
      _sum: { amount: true, sessionsGranted: true },
    });
    const serviceIds = grouped
      .map((row) => row.serviceId)
      .filter((id): id is string => Boolean(id));
    const services = serviceIds.length
      ? await this.prisma.service.findMany({
          where: { businessId, id: { in: serviceIds } },
          select: { id: true, name: true, sessionCount: true },
        })
      : [];
    const names = new Map(services.map((row) => [row.id, row]));
    return grouped
      .map((row) => {
        const service = row.serviceId ? names.get(row.serviceId) : null;
        return {
          serviceId: row.serviceId,
          name: service?.name ?? 'Sin servicio',
          sessionCount: service?.sessionCount ?? 1,
          payments: row._count.id,
          amount: Number(row._sum.amount?.toString() ?? 0),
          sessionsGranted: row._sum.sessionsGranted ?? 0,
        };
      })
      .sort((a, b) => b.amount - a.amount || b.payments - a.payments);
  }

  async create(input: PaymentInput) {
    const businessId = await this.businesses.getCurrentId();
    const client = await this.requireClient(businessId, input.userId);
    const amount = this.requireAmount(input.amount);
    const paidAt = this.requirePaidAt(input.paidAt);
    const service = input.serviceId
      ? await this.requireService(businessId, input.serviceId)
      : null;
    const coverage = this.resolveCoverage(service, amount, input.cover);

    const created = await this.prisma.$transaction(async (tx) => {
      const pass =
        coverage.needsPass && service
          ? await this.creditPass(tx, {
              businessId,
              userId: client.id,
              service,
              granted: coverage.granted,
              consumed: coverage.consumed,
              cover: coverage.cover,
            })
          : null;
      return tx.payment.create({
        data: {
          businessId,
          userId: client.id,
          serviceId: service?.id ?? null,
          passId: pass?.id ?? null,
          amount: new Prisma.Decimal(amount),
          paidAt,
          notes: input.notes?.trim() || null,
          sessionsGranted: coverage.granted,
          sessionsConsumed: coverage.consumed,
        },
        include: paymentInclude,
      });
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
    const serviceTouched =
      input.serviceId !== undefined || input.cover !== undefined;
    const nextUserId = client?.id ?? existing.userId;
    const nextAmount = amount ?? Number(existing.amount.toString());
    const nextServiceId =
      input.serviceId !== undefined ? input.serviceId : existing.serviceId;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (serviceTouched || (client && client.id !== existing.userId)) {
        await this.revertPass(tx, existing);
        const service = nextServiceId
          ? await this.requireService(businessId, nextServiceId, tx)
          : null;
        const coverage = this.resolveCoverage(service, nextAmount, input.cover);
        const pass =
          coverage.needsPass && service
            ? await this.creditPass(tx, {
                businessId,
                userId: nextUserId,
                service,
                granted: coverage.granted,
                consumed: coverage.consumed,
                cover: coverage.cover,
              })
            : null;
        return tx.payment.update({
          where: { id },
          data: {
            userId: nextUserId,
            serviceId: service?.id ?? null,
            passId: pass?.id ?? null,
            ...(amount !== undefined
              ? { amount: new Prisma.Decimal(amount) }
              : {}),
            ...(paidAt ? { paidAt } : {}),
            ...(input.notes !== undefined
              ? { notes: input.notes?.trim() || null }
              : {}),
            sessionsGranted: coverage.granted,
            sessionsConsumed: coverage.consumed,
          },
          include: paymentInclude,
        });
      }

      return tx.payment.update({
        where: { id },
        data: {
          ...(client ? { userId: client.id } : {}),
          ...(amount !== undefined ? { amount: new Prisma.Decimal(amount) } : {}),
          ...(paidAt ? { paidAt } : {}),
          ...(input.notes !== undefined
            ? { notes: input.notes?.trim() || null }
            : {}),
        },
        include: paymentInclude,
      });
    });
    return this.toPayment(updated);
  }

  async remove(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.payment.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Pago no encontrado');
    await this.prisma.$transaction(async (tx) => {
      await this.revertPass(tx, existing);
      await tx.payment.delete({ where: { id } });
    });
    return { id };
  }

  async useSession(passId: string) {
    const businessId = await this.businesses.getCurrentId();
    const pass = await this.prisma.servicePass.findFirst({
      where: { id: passId, businessId },
    });
    if (!pass) throw new NotFoundException('Pack no encontrado');
    if (pass.sessionsUsed >= pass.sessionsPaid) {
      throw new BadRequestException('No quedan clases en este pack.');
    }
    const updated = await this.prisma.servicePass.update({
      where: { id: pass.id },
      data: { sessionsUsed: pass.sessionsUsed + 1 },
      include: {
        service: { select: { id: true, name: true, sessionCount: true } },
      },
    });
    return this.toPass(updated);
  }

  private resolveCoverage(
    service: { sessionCount: number; price: Prisma.Decimal | null } | null,
    amount: number,
    cover?: PaymentCover,
  ) {
    if (!service || service.sessionCount <= 1) {
      return {
        cover: 'session' as PaymentCover,
        granted: 0,
        consumed: 0,
        needsPass: false,
      };
    }
    const mode = cover ?? this.defaultCover(service, amount);
    if (mode === 'pack') {
      return {
        cover: 'pack' as PaymentCover,
        granted: service.sessionCount,
        consumed: 0,
        needsPass: true,
      };
    }
    return {
      cover: 'session' as PaymentCover,
      granted: 1,
      consumed: 1,
      needsPass: true,
    };
  }

  private defaultCover(
    service: { sessionCount: number; price: Prisma.Decimal | null },
    amount: number,
  ): PaymentCover {
    if (service.price != null) {
      const price = Number(service.price.toString());
      if (Number.isFinite(price) && price > 0 && Math.abs(amount - price) < 0.01) {
        return 'pack';
      }
      if (Number.isFinite(price) && price > 0) return 'session';
    }
    return 'pack';
  }

  private async creditPass(
    tx: Prisma.TransactionClient,
    input: {
      businessId: string;
      userId: string;
      service: { id: string; sessionCount: number };
      granted: number;
      consumed: number;
      cover: PaymentCover;
    },
  ) {
    const existing = await tx.servicePass.findMany({
      where: {
        businessId: input.businessId,
        userId: input.userId,
        serviceId: input.service.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    const open = existing.find((row) => row.sessionsPaid < row.sessionCount);
    const reuse =
      input.cover === 'session'
        ? open
        : open && open.sessionsPaid === 0
          ? open
          : null;
    const pass =
      reuse ??
      (await tx.servicePass.create({
        data: {
          businessId: input.businessId,
          userId: input.userId,
          serviceId: input.service.id,
          sessionCount: input.service.sessionCount,
          sessionsPaid: 0,
          sessionsUsed: 0,
        },
      }));
    const nextPaid = pass.sessionsPaid + input.granted;
    if (nextPaid > pass.sessionCount) {
      throw new BadRequestException(
        `Este pack es de ${pass.sessionCount} clases. Ya hay ${pass.sessionsPaid} pagadas.`,
      );
    }
    return tx.servicePass.update({
      where: { id: pass.id },
      data: {
        sessionsPaid: nextPaid,
        sessionsUsed: pass.sessionsUsed + input.consumed,
      },
    });
  }

  private async revertPass(
    tx: Prisma.TransactionClient,
    payment: {
      passId: string | null;
      sessionsGranted: number;
      sessionsConsumed: number;
    },
  ) {
    if (!payment.passId) return;
    const pass = await tx.servicePass.findFirst({
      where: { id: payment.passId },
    });
    if (!pass) return;
    const paid = Math.max(0, pass.sessionsPaid - payment.sessionsGranted);
    const used = Math.max(0, pass.sessionsUsed - payment.sessionsConsumed);
    const usedClamped = Math.min(used, paid);
    if (paid === 0 && usedClamped === 0) {
      await tx.payment.updateMany({
        where: { passId: pass.id },
        data: { passId: null },
      });
      await tx.servicePass.delete({ where: { id: pass.id } });
      return;
    }
    await tx.servicePass.update({
      where: { id: pass.id },
      data: { sessionsPaid: paid, sessionsUsed: usedClamped },
    });
  }

  private async requireClient(businessId: string, userId: string) {
    const client = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
    });
    if (!client) throw new BadRequestException('Cliente no encontrado');
    return client;
  }

  private async requireService(
    businessId: string,
    serviceId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const service = await db.service.findFirst({
      where: { id: serviceId, businessId },
    });
    if (!service) throw new BadRequestException('Servicio no encontrado');
    return service;
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
    sessionsGranted: number;
    sessionsConsumed: number;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
    };
    service: {
      id: string;
      name: string;
      sessionCount: number;
      price?: Prisma.Decimal | null;
    } | null;
    pass: {
      id: string;
      sessionCount: number;
      sessionsPaid: number;
      sessionsUsed: number;
    } | null;
  }) {
    return {
      id: row.id,
      amount: Number(row.amount.toString()),
      paidAt: row.paidAt.toISOString().slice(0, 10),
      notes: row.notes,
      sessionsGranted: row.sessionsGranted,
      sessionsConsumed: row.sessionsConsumed,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      client: row.user,
      service: row.service
        ? {
            id: row.service.id,
            name: row.service.name,
            sessionCount: row.service.sessionCount,
          }
        : null,
      pass: row.pass ? this.toPass(row.pass) : null,
    };
  }

  private toPass(pass: {
    id: string;
    sessionCount: number;
    sessionsPaid: number;
    sessionsUsed: number;
    service?: { id: string; name: string; sessionCount: number };
  }) {
    const remaining = Math.max(0, pass.sessionCount - pass.sessionsPaid);
    const unusedCredits = Math.max(0, pass.sessionsPaid - pass.sessionsUsed);
    return {
      id: pass.id,
      sessionCount: pass.sessionCount,
      sessionsPaid: pass.sessionsPaid,
      sessionsUsed: pass.sessionsUsed,
      remaining,
      unusedCredits,
      ...(pass.service ? { service: pass.service } : {}),
    };
  }
}
