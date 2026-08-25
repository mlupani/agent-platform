import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';
import { PackBalanceService } from '../../../packs/pack-balance.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const schema = z.object({
  studentId: z.string().min(1).optional().describe('UUID del alumno (User.id). Preferido si se conoce.'),
  phone: z.string().min(1).optional().describe('Teléfono del alumno para buscarlo si no se tiene studentId.'),
  email: z.string().email().optional().describe('Email del alumno.'),
});

@Injectable()
export class GetStudentBalanceTool implements AgentTool {
  readonly name = 'consultar_saldo_clases';
  readonly description =
    'Consulta cuántas clases disponibles tiene un alumno. Fuente de verdad: sistema de packs/créditos, no calendario. Usalo antes de confirmar una reserva. Si es ALUMNO sin clases, no ofrezcas prueba gratuita, informa que debe renovar.';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(
    private readonly packs: PackBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    let userId = data.studentId;

    if (!userId && (data.phone || data.email)) {
      const phone = data.phone?.replace(/\D/g, '') || undefined;
      const user = await this.prisma.user.findFirst({
        where: {
          businessId: context.businessId,
          ...(phone ? { phone: { contains: phone.slice(-8) } } : {}),
          ...(data.email ? { email: data.email.trim().toLowerCase() } : {}),
        },
      });
      if (user) userId = user.id;
    }

    // Si no hay studentId y no se pudo resolver por phone/email, intentar por conversación
    if (!userId && context.conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: context.conversationId, businessId: context.businessId },
        select: { userId: true, contactPhone: true },
      });
      if (conv?.userId) userId = conv.userId;
      else if (conv?.contactPhone) {
        const p = conv.contactPhone.replace(/\D/g, '').slice(-8);
        const u = await this.prisma.user.findFirst({
          where: { businessId: context.businessId, phone: { contains: p } },
        });
        if (u) userId = u.id;
      }
    }

    if (!userId) {
      return {
        success: false,
        error: 'No se pudo identificar al alumno. Pedí teléfono o email para consultar saldo.',
      };
    }

    try {
      const balance = await this.packs.getBalance(context.businessId, userId);
      return {
        success: true,
        data: {
          studentId: balance.studentId,
          studentName: balance.studentName,
          availableClasses: balance.availableClasses,
          hasAvailableClasses: balance.hasAvailableClasses,
          activePacks: balance.activePacks.map((p) => ({
            id: p.id,
            name: p.name,
            totalClasses: p.totalClasses,
            usedClasses: p.usedClasses,
            remainingClasses: p.remainingClasses,
            status: p.status,
            expiresAt: p.expiresAt,
          })),
          packs: balance.activePacks.map((p) => ({
            name: p.name,
            remainingClasses: p.remainingClasses,
            status: p.status,
          })),
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al consultar saldo' };
    }
  }
}
