import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LeadsService } from '../../../leads/leads.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(40).optional(),
  message: z.string().max(2000).optional(),
  source: z.string().max(80).optional(),
});

@Injectable()
export class CreateLeadTool implements AgentTool {
  readonly name = 'createLead';
  readonly description =
    'Guarda un contacto cuando el usuario deja datos sin reservar. Si ya hay reserva, createAppointment guarda el lead.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(private readonly leads: LeadsService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    const lead = await this.leads.capture({
      businessId: context.businessId,
      userId: context.userId,
      conversationId: context.conversationId || undefined,
      name: data.name,
      email: data.email,
      phone: data.phone,
      message: data.message,
      source: data.source ?? context.channel,
      metadata: {
        conversationId: context.conversationId,
        idempotencyKey: context.idempotencyKey,
      },
    });

    if (!lead) {
      return {
        success: false,
        error: 'Hace falta al menos nombre, email o teléfono.',
      };
    }

    return {
      success: true,
      data: { leadId: lead.id },
    };
  }
}
