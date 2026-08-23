import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LeadsService } from '../../../leads/leads.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';
import { LEAD_STATUSES } from '../../../leads/lead.constants';

const schema = z.object({
  status: z.enum(['contacted', 'interested', 'lost']).optional(),
  interest: z.string().max(200).optional(),
  objections: z.string().max(500).optional(),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(40).optional(),
  message: z.string().max(2000).optional(),
});

@Injectable()
export class UpdateLeadStatusTool implements AgentTool {
  readonly name = 'updateLeadStatus';
  readonly description =
    'Actualiza el estado o el interés del lead de esta conversación. Usá interested si hay ganas reales de comprar/reservar. lost si dijo que no. No marques won.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(private readonly leads: LeadsService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    const existing = context.conversationId
      ? await this.leads.findByConversation(
          context.businessId,
          context.conversationId,
        )
      : null;
    const lead = await this.leads.capture({
      businessId: context.businessId,
      conversationId: context.conversationId || undefined,
      userId: context.userId,
      name: data.name || existing?.name,
      email: data.email || existing?.email,
      phone: data.phone || existing?.phone,
      message: data.message,
      interest: data.interest,
      objections: data.objections,
      status: data.status,
      source: context.channel,
    });
    if (!lead) {
      return {
        success: false,
        error: 'Hace falta al menos nombre, email o teléfono para actualizar el lead.',
      };
    }
    return { success: true, data: { leadId: lead.id, status: data.status ?? null } };
  }
}

void LEAD_STATUSES;
