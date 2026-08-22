import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { withExponentialBackoff } from '../../common/utils/retry';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMProvider,
  LlmMessage,
} from './llm-provider.interface';

@Injectable()
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  private readonly embeddingModel: string;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY') ?? '',
    });
    this.embeddingModel = this.config.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-small',
    );
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const completion = await withExponentialBackoff(() =>
      this.client.chat.completions.create({
        model: request.model,
        ...this.buildSamplingParams(request.model, request.temperature),
        ...this.buildTokenLimitParams(request.model, request.maxTokens),
        messages: this.toOpenAIMessages(request.messages),
        tools: request.tools?.length
          ? request.tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            }))
          : undefined,
      }),
    );

    const choice = completion.choices[0];
    const toolCalls =
      choice?.message.tool_calls?.flatMap((call) => {
        if (call.type !== 'function') return [];
        return [
          {
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          },
        ];
      }) ?? [];

    return {
      content: choice?.message.content ?? null,
      toolCalls,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      model: completion.model,
      finishReason: this.mapFinishReason(choice?.finish_reason),
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      ...this.buildSamplingParams(request.model, request.temperature),
      ...this.buildTokenLimitParams(request.model, request.maxTokens),
      stream: true,
      messages: this.toOpenAIMessages(request.messages),
      tools: request.tools?.length
        ? request.tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
        : undefined,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        yield { delta, done: false };
      }
    }

    yield { delta: '', done: true };
  }

  async embeddings(
    input: string | string[],
    model?: string,
  ): Promise<number[][]> {
    const response = await withExponentialBackoff(() =>
      this.client.embeddings.create({
        model: model ?? this.embeddingModel,
        input,
      }),
    );

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  /** gpt-5 / o-series rechazan max_tokens; usan max_completion_tokens. */
  private requiresMaxCompletionTokens(model: string): boolean {
    const m = model.toLowerCase();
    return (
      m.startsWith('gpt-5') ||
      m.startsWith('o1') ||
      m.startsWith('o3') ||
      m.startsWith('o4')
    );
  }

  /** Algunos modelos solo aceptan temperature por defecto (1). */
  private supportsCustomTemperature(model: string): boolean {
    return !this.requiresMaxCompletionTokens(model);
  }

  private buildTokenLimitParams(
    model: string,
    maxTokens?: number,
  ):
    | { max_tokens: number }
    | { max_completion_tokens: number }
    | Record<string, never> {
    if (maxTokens == null) return {};
    if (this.requiresMaxCompletionTokens(model)) {
      return { max_completion_tokens: maxTokens };
    }
    return { max_tokens: maxTokens };
  }

  private buildSamplingParams(
    model: string,
    temperature?: number,
  ): { temperature: number } | Record<string, never> {
    if (temperature == null || !this.supportsCustomTemperature(model)) {
      return {};
    }
    return { temperature };
  }

  private toOpenAIMessages(
    messages: LlmMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId ?? '',
          content: message.content,
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      return {
        role: message.role,
        content: message.content,
      };
    });
  }

  private mapFinishReason(
    reason: string | null | undefined,
  ): ChatResponse['finishReason'] {
    if (reason === 'tool_calls') return 'tool_calls';
    if (reason === 'length') return 'length';
    if (reason === 'stop') return 'stop';
    return 'stop';
  }
}
