import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AutomationsService } from '../../../automations/automations.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({
  automationName: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()).optional(),
});

@Injectable()
export class TriggerAutomationTool implements AgentTool {
  readonly name = 'triggerAutomation';
  readonly description =
    'Dispara una automatización periférica (n8n u otro webhook) configurada para el negocio.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(private readonly automations: AutomationsService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    const result = await this.automations.triggerByName(
      context.businessId,
      data.automationName,
      {
        ...data.payload,
        conversationId: context.conversationId,
        userId: context.userId,
        channel: context.channel,
      },
      context.idempotencyKey,
    );

    return result;
  }
}
