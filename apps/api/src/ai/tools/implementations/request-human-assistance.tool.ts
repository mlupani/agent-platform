import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';

const schema = z.object({
  reason: z.string().max(500).optional(),
});

@Injectable()
export class RequestHumanAssistanceTool implements AgentTool {
  readonly name = 'requestHumanAssistance';
  readonly description =
    'Deriva la conversación a un humano. Usar cuando el usuario lo pide o el caso requiere atención personal.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    await this.prisma.conversation.updateMany({
      where: { id: context.conversationId, businessId: context.businessId },
      data: {
        status: 'WAITING_HUMAN',
        metadata: {
          handoffReason: data.reason ?? 'user_request',
          handoffAt: new Date().toISOString(),
        },
      },
    });

    return {
      success: true,
      data: {
        status: 'WAITING_HUMAN',
        reason: data.reason ?? 'user_request',
      },
    };
  }
}
