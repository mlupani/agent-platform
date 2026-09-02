import type { ConversationStatus } from '../../common/constants';
import type { VectorMatch } from '../vector-store/vector-store.interface';
import type { LlmToolCall } from '../providers/llm-provider.interface';

export interface AgentRunInput {
  businessId: string;
  conversationId?: string;
  message: string;
  channel?: string;
  userId?: string;
  agentConfigId?: string;
  debug?: boolean;
  confirmed?: boolean;
  metadata?: Record<string, unknown>;
  /** Tope de pasos del loop para este run (voz usa un valor más bajo por latencia). */
  maxStepsOverride?: number;
}

export interface AgentDebugToolCall {
  name: string;
  input: unknown;
  output: unknown;
  success: boolean;
  durationMs?: number;
  error?: string;
  step?: number;
}

export interface AgentDebugInfo {
  executionId: string;
  steps: number;
  tools: AgentDebugToolCall[];
  ragChunks: VectorMatch[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: number;
  model: string;
  provider: string;
  systemPrompt?: string;
  success: boolean;
  error?: string;
}

export interface AgentRunResult {
  conversationId: string;
  message: string;
  status: ConversationStatus;
  debug?: AgentDebugInfo;
}

export interface ExecutedTool {
  call: LlmToolCall;
  result: unknown;
  success: boolean;
  durationMs?: number;
  error?: string;
  step?: number;
}
