import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';
import { StudentContextService } from '../../../students/student-context.service';

const schema = z.object({
  phone: z.string().min(1).optional().describe('Teléfono del contacto (estable, del canal).'),
  email: z.string().email().optional().describe('Email del contacto.'),
});

@Injectable()
export class ResolveStudentContextTool implements AgentTool {
  readonly name = 'consultar_contexto_alumno';
  readonly description =
    'Identifica quién es la persona que escribe según el canal (phone/email/whatsapp). Devuelve PROSPECT, ACTIVE_STUDENT, STUDENT_WITHOUT_CREDITS o INACTIVE_STUDENT con availableClasses y hasTrialAlreadyUsed. Usalo ANTES de ofrecer prueba o reservar. No deduzcas por nombre.';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(private readonly ctx: StudentContextService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    // Priorizar phone/email del input, si no, usar los del contexto de conversación
    let phone = data.phone;
    let email = data.email;

    if (!phone && !email && context.conversationId) {
      // El servicio resolverá por conversationId si no hay phone/email explícito
    }

    // Si no hay phone/email en input, el servicio buscará por conversationId
    try {
      const result = await this.ctx.resolveStudentContext({
        businessId: context.businessId,
        phone: phone ?? null,
        email: email ?? null,
        conversationId: context.conversationId ?? null,
      });

      return {
        success: true,
        data: {
          found: result.found,
          student: result.student,
          relationshipStatus: result.relationshipStatus,
          availableClasses: result.availableClasses,
          activePackCount: result.activePackCount,
          hasTrialAlreadyUsed: result.hasTrialAlreadyUsed,
          // alias para compatibilidad con spec
          hasAvailableClasses: result.availableClasses !== null ? result.availableClasses > 0 : null,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al resolver contexto' };
    }
  }
}
