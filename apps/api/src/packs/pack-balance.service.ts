import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export interface PackBalance {
  studentId: string;
  studentName?: string | null;
  availableClasses: number;
  hasAvailableClasses: boolean;
  activePacks: Array<{
    id: string;
    name: string;
    totalClasses: number;
    usedClasses: number;
    remainingClasses: number;
    status: string;
    serviceId: string;
    expiresAt: Date | null;
    createdAt: Date;
  }>;
  allPacks: Array<{
    id: string;
    name: string;
    totalClasses: number;
    usedClasses: number;
    remainingClasses: number;
    status: string;
    createdAt: Date;
  }>;
}

@Injectable()
export class PackBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(businessId: string, userId: string): Promise<PackBalance> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { id: true, name: true },
    });
    if (!user) throw new BadRequestException('Alumno no encontrado');

    const passes = await this.prisma.servicePass.findMany({
      where: { businessId, userId },
      include: { service: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const allPacks = passes.map((p) => ({
      id: p.id,
      name: p.service.name,
      totalClasses: p.sessionsPaid,
      usedClasses: p.sessionsUsed,
      remainingClasses: Math.max(0, p.sessionsPaid - p.sessionsUsed),
      status: p.status,
      createdAt: p.createdAt,
    }));

    const activePacks = passes
      .filter((p) => p.status === 'ACTIVE' && p.sessionsPaid - p.sessionsUsed > 0)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => ({
        id: p.id,
        name: p.service.name,
        totalClasses: p.sessionsPaid,
        usedClasses: p.sessionsUsed,
        remainingClasses: Math.max(0, p.sessionsPaid - p.sessionsUsed),
        status: p.status,
        serviceId: p.serviceId,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
      }));

    const availableClasses = activePacks.reduce((acc, p) => acc + p.remainingClasses, 0);

    return {
      studentId: user.id,
      studentName: user.name,
      availableClasses,
      hasAvailableClasses: availableClasses > 0,
      activePacks,
      allPacks,
    };
  }

  async purchasePack(params: {
    businessId: string;
    userId: string;
    serviceId: string;
    amount?: number;
    reason?: string;
  }) {
    const service = await this.prisma.service.findFirst({
      where: { id: params.serviceId, businessId: params.businessId, enabled: true },
    });
    if (!service) throw new BadRequestException('Servicio no encontrado');
    const total = service.sessionCount || 1;

    return this.prisma.$transaction(async (tx) => {
      const pass = await tx.servicePass.create({
        data: {
          businessId: params.businessId,
          userId: params.userId,
          serviceId: service.id,
          sessionCount: total,
          sessionsPaid: total,
          sessionsUsed: 0,
          status: 'ACTIVE',
        },
      });

      await tx.classCreditMovement.create({
        data: {
          businessId: params.businessId,
          userId: params.userId,
          servicePassId: pass.id,
          type: 'PURCHASE',
          amount: total,
          reason: params.reason || `Compra ${service.name}`,
        },
      });

      // Opcional: crear Payment si amount provided
      if (params.amount !== undefined) {
        await tx.payment.create({
          data: {
            businessId: params.businessId,
            userId: params.userId,
            serviceId: service.id,
            passId: pass.id,
            amount: params.amount,
            paidAt: new Date(),
            sessionsGranted: total,
            notes: params.reason,
          },
        });
      }

      return pass;
    });
  }

  async consumeCredit(params: {
    businessId: string;
    userId: string;
    appointmentId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: params.appointmentId, businessId: params.businessId, userId: params.userId },
      });
      if (!appointment) throw new BadRequestException('Asistencia no encontrada');
      if (appointment.servicePassId) {
        // ya consumido
        return appointment;
      }
      if (appointment.status !== 'completed') {
        throw new BadRequestException('Solo se consume al completar la asistencia');
      }

      // Buscar packs válidos más antiguos primero (sin vencimiento -> createdAt asc)
      const packs = await tx.servicePass.findMany({
        where: {
          businessId: params.businessId,
          userId: params.userId,
          status: 'ACTIVE',
        },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      });

      const pack = packs.find((p) => p.sessionsPaid - p.sessionsUsed > 0);
      if (!pack) throw new BadRequestException('Alumno sin clases disponibles');

      // Update transaccional con condición para evitar race (remaining >0)
      const updated = await tx.servicePass.updateMany({
        where: {
          id: pack.id,
          sessionsUsed: { lt: pack.sessionsPaid },
          status: 'ACTIVE',
        },
        data: {
          sessionsUsed: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new BadRequestException('Concurrencia: sin clases disponibles, reintenta');

      const fresh = await tx.servicePass.findUniqueOrThrow({ where: { id: pack.id } });
      const remaining = fresh.sessionsPaid - fresh.sessionsUsed;
      if (remaining <= 0) {
        await tx.servicePass.update({ where: { id: pack.id }, data: { status: 'COMPLETED' } });
      }

      await tx.classCreditMovement.create({
        data: {
          businessId: params.businessId,
          userId: params.userId,
          servicePassId: pack.id,
          appointmentId: appointment.id,
          type: 'CONSUMPTION',
          amount: -1,
          reason: `Asistencia ${appointment.startsAt.toISOString().slice(0, 10)}`,
        },
      });

      const updatedAppointment = await tx.appointment.update({
        where: { id: appointment.id },
        data: { servicePassId: pack.id },
      });

      return updatedAppointment;
    });
  }

  async adjustBalance(params: {
    businessId: string;
    userId: string;
    servicePassId?: string;
    amount: number; // +1 o -1
    reason?: string;
  }) {
    if (params.amount === 0) throw new BadRequestException('Amount no puede ser 0');
    return this.prisma.$transaction(async (tx) => {
      let pass: any = null;
      if (params.servicePassId) {
        pass = await tx.servicePass.findFirst({
          where: { id: params.servicePassId, businessId: params.businessId, userId: params.userId },
        });
        if (!pass) throw new BadRequestException('Pack no encontrado');
      } else {
        // si no se especifica pack, ajustar el activo más antiguo
        const packs = await tx.servicePass.findMany({
          where: { businessId: params.businessId, userId: params.userId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });
        pass = packs.find((p) => params.amount > 0 || p.sessionsPaid - p.sessionsUsed > 0 || p.sessionsUsed > 0) || packs[0];
        if (!pass) throw new BadRequestException('Sin pack activo para ajustar');
      }

      if (params.amount < 0) {
        const remaining = pass.sessionsPaid - pass.sessionsUsed;
        if (remaining + params.amount < 0) throw new BadRequestException('Ajuste excede clases disponibles');
        // para descuento, incrementar sessionsUsed
        await tx.servicePass.update({
          where: { id: pass.id },
          data: {
            sessionsUsed: { increment: Math.abs(params.amount) },
            status: pass.sessionsPaid - (pass.sessionsUsed + Math.abs(params.amount)) <= 0 ? 'COMPLETED' : 'ACTIVE',
          },
        });
      } else {
        await tx.servicePass.update({
          where: { id: pass.id },
          data: {
            sessionsPaid: { increment: params.amount },
            status: 'ACTIVE',
          },
        });
      }

      await tx.classCreditMovement.create({
        data: {
          businessId: params.businessId,
          userId: params.userId,
          servicePassId: pass.id,
          type: 'MANUAL_ADJUSTMENT',
          amount: params.amount,
          reason: params.reason || 'Ajuste manual',
        },
      });

      return tx.servicePass.findUniqueOrThrow({ where: { id: pass.id } });
    });
  }
}
