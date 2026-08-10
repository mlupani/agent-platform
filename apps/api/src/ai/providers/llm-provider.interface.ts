export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Gemini: firmas de pensamiento a reenviar en el siguiente turno de tools */
  thoughtSignature?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  model: string;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface ChatStreamChunk {
  delta: string;
  done: boolean;
}

export interface LLMProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  embeddings(input: string | string[], model?: string): Promise<number[][]>;
}
