import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';

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
    'Crea un lead o consulta de contacto a partir de los datos del usuario.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    const lead = await this.prisma.lead.create({
      data: {
        businessId: context.businessId,
        userId: context.userId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        message: data.message,
        source: data.source ?? context.channel,
        metadata: {
          conversationId: context.conversationId,
          idempotencyKey: context.idempotencyKey,
        },
      },
    });

    return {
      success: true,
      data: { leadId: lead.id },
    };
  }
}
