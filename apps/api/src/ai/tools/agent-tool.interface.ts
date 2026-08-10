import type { ZodType } from 'zod';
import type { ToolRisk } from '../../common/constants';

export interface ToolContext {
  businessId: string;
  conversationId: string;
  userId?: string;
  channel: string;
  metadata?: Record<string, unknown>;
  enabledTools: string[];
  idempotencyKey?: string;
  agentExecutionId?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
  durationMs?: number;
}

export interface AgentTool {
  name: string;
  description: string;
  schema: ZodType;
  risk: ToolRisk;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
