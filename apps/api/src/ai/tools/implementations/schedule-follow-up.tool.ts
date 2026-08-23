import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { LeadFollowUpService } from '../../../leads/lead-follow-up.service';
import { LeadsService } from '../../../leads/leads.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({
  scheduledAt: z
    .string()
    .datetime()
    .optional()
    .describe('ISO 8601. Si falta, usá delayHours.'),
  delayHours: z.number().int().min(1).max(24 * 30).optional(),
  objective: z.string().min(1).max(80),
  objectiveNote: z.string().max(500).optional(),
});

@Injectable()
export class ScheduleFollowUpTool implements AgentTool {
  readonly name = 'scheduleFollowUp';
  readonly description =
    'Programa un seguimiento futuro cuando el usuario pide que lo contacten más adelante. No lo uses para "en un rato": solo fechas concretas o delays claros.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(
    private readonly leads: LeadsService,
    private readonly followUps: LeadFollowUpService,
  ) {}

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
      name:
        existing?.name ||
        (context.metadata?.contactName as string | undefined) ||
        undefined,
      email: existing?.email || undefined,
      phone:
        existing?.phone ||
        (context.metadata?.contactPhone as string | undefined) ||
        undefined,
      source: context.channel,
    });
    if (!lead) {
      return {
        success: false,
        error: 'No hay lead para programar el seguimiento.',
      };
    }
    const scheduledAt = data.scheduledAt
      ? new Date(data.scheduledAt)
      : DateTime.now().plus({ hours: data.delayHours ?? 24 }).toJSDate();
    const created = await this.followUps.create({
      businessId: context.businessId,
      leadId: lead.id,
      source: 'agent',
      objective: data.objective,
      objectiveNote: data.objectiveNote,
      scheduledAt,
      actor: 'agent',
    });
    return {
      success: true,
      data: { followUpId: created.id, scheduledAt: created.scheduledAt },
    };
  }
}
