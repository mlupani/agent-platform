import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PackBalanceService } from '../packs/pack-balance.service';

export type RelationshipStatus = 'PROSPECT' | 'ACTIVE_STUDENT' | 'STUDENT_WITHOUT_CREDITS' | 'INACTIVE_STUDENT';

export interface StudentContext {
  contact: { id?: string; phone?: string | null; email?: string | null };
  student: { id: string; name: string | null; hasUsedTrial: boolean } | null;
  relationshipStatus: RelationshipStatus;
  availableClasses: number | null;
  activePackCount: number | null;
  hasTrialAlreadyUsed: boolean;
  found: boolean;
}

@Injectable()
export class StudentContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packs: PackBalanceService,
  ) {}

  private normalizePhone(phone?: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) return null;
    // Argentina: keep last 10-13 digits with +54 handling simplified: store as digits
    return digits;
  }

  async resolveStudentContext(params: {
    businessId: string;
    phone?: string | null;
    email?: string | null;
    conversationId?: string | null;
  }): Promise<StudentContext> {
    const phoneNorm = this.normalizePhone(params.phone);
    const emailNorm = params.email?.trim().toLowerCase() || null;

    let user: any = null;

    if (phoneNorm) {
      // buscar por phone exacto o digits suffix
      user = await this.prisma.user.findFirst({
        where: {
          businessId: params.businessId,
          phone: { contains: phoneNorm.slice(-8) }, // suffix match para variaciones +54
        },
      });
      // si no encontró, intentar por phone completo
      if (!user) {
        user = await this.prisma.user.findFirst({
          where: { businessId: params.businessId, phone: phoneNorm },
        });
      }
    }
    if (!user && emailNorm) {
      user = await this.prisma.user.findFirst({
        where: { businessId: params.businessId, email: emailNorm },
      });
    }
    if (!user && params.conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: params.conversationId, businessId: params.businessId },
        select: { userId: true, contactPhone: true },
      });
      if (conv?.userId) {
        user = await this.prisma.user.findFirst({ where: { id: conv.userId } });
      } else if (conv?.contactPhone) {
        const cPhone = this.normalizePhone(conv.contactPhone);
        if (cPhone) {
          user = await this.prisma.user.findFirst({
            where: { businessId: params.businessId, phone: { contains: cPhone.slice(-8) } },
          });
        }
      }
    }

    if (!user) {
      return {
        contact: { phone: phoneNorm, email: emailNorm },
        student: null,
        relationshipStatus: 'PROSPECT',
        availableClasses: null,
        activePackCount: null,
        hasTrialAlreadyUsed: false,
        found: false,
      };
    }

    const balance = await this.packs.getBalance(params.businessId, user.id).catch(() => null);
    const available = balance?.availableClasses ?? 0;
    const activeCount = balance?.activePacks.length ?? 0;
    const hasPassHistory = (balance?.allPacks.length ?? 0) > 0;

    let status: RelationshipStatus = 'INACTIVE_STUDENT';
    if (available > 0) status = 'ACTIVE_STUDENT';
    else if (hasPassHistory) {
      // tiene packs pero sin saldo => sin créditos
      const hasActivePass = activeCount > 0 || (balance?.allPacks.some((p) => p.status === 'ACTIVE') ?? false);
      // diferencia: si tuvo packs y ahora 0 => STUDENT_WITHOUT_CREDITS, si solo histórico antiguo => INACTIVE
      // usamos: si alguna vez tuvo pass y available==0 => WITHOUT_CREDITS si último pass es reciente (<90d) sino INACTIVE
      // simplificado: si alguna vez tuvo pass y available==0 => WITHOUT_CREDITS
      status = 'STUDENT_WITHOUT_CREDITS';
      // si no tiene passes activos pero sí histórico muy viejo, considerar INACTIVE
      if (!hasPassHistory) status = 'INACTIVE_STUDENT';
    } else {
      // existe como User pero sin passes nunca => tratar como INACTIVE (ya fue alumna sin packs)
      status = 'INACTIVE_STUDENT';
    }

    const hasTrial = user.hasUsedTrial || (await this.prisma.appointment.count({ where: { businessId: params.businessId, userId: user.id, isTrial: true } })) > 0;

    return {
      contact: { id: user.id, phone: user.phone, email: user.email },
      student: { id: user.id, name: user.name, hasUsedTrial: hasTrial },
      relationshipStatus: status,
      availableClasses: available,
      activePackCount: activeCount,
      hasTrialAlreadyUsed: hasTrial,
      found: true,
    };
  }
}
