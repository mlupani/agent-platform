import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';

const schema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(180),
  body: z.string().min(1).max(5000),
});

@Injectable()
export class SendEmailTool implements AgentTool {
  readonly name = 'sendEmail';
  readonly description =
    'Envía un email usando la integración de correo del negocio. No inventar destinatarios.';
  readonly schema = schema;
  readonly risk = 'SENSITIVE' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    const integration = await this.prisma.integration.findFirst({
      where: {
        businessId: context.businessId,
        type: 'email',
        enabled: true,
      },
    });

    if (!integration) {
      return {
        success: false,
        error:
          'No hay una integración de email habilitada para este negocio. Configúrala en el panel.',
      };
    }

    return {
      success: true,
      data: {
        queued: true,
        to: data.to,
        subject: data.subject,
        integrationId: integration.id,
        note: 'El envío real se delega a la integración configurada o a n8n.',
      },
    };
  }
}
