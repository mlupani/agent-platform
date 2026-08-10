import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMProvider,
  LlmMessage,
  LlmToolCall,
} from './llm-provider.interface';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

@Injectable()
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client: GoogleGenAI | null;

  constructor(private readonly config: ConfigService) {
    const apiKey =
      this.config.get<string>('GOOGLE_GENERATIVE_AI_API_KEY') ||
      this.config.get<string>('GEMINI_API_KEY') ||
      '';
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.client) {
      throw new Error(
        'Gemini no configurado: falta GOOGLE_GENERATIVE_AI_API_KEY',
      );
    }

    const { systemInstruction, contents } = this.toGeminiContents(
      request.messages,
    );
    if (!contents.length) {
      throw new Error('Gemini chat requiere al menos un mensaje de usuario');
    }

    const tools = request.tools?.length
      ? [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: this.sanitizeToolParameters(
                tool.parameters,
              ),
            })),
          },
        ]
      : undefined;

    const response = await this.client.models.generateContent({
      model: request.model,
      contents,
      config: {
        systemInstruction: systemInstruction || undefined,
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        tools,
        // El AgentService maneja el loop de tools manualmente
        automaticFunctionCalling: { disable: true },
      },
    });

    const toolCalls = this.extractToolCalls(response as unknown);
    const content =
      typeof response.text === 'string' && response.text.trim()
        ? response.text
        : this.extractText(response as unknown);

    const usageMeta = response.usageMetadata;
    return {
      content,
      toolCalls,
      usage: {
        inputTokens: usageMeta?.promptTokenCount ?? 0,
        outputTokens:
          usageMeta?.candidatesTokenCount ??
          usageMeta?.totalTokenCount ??
          0,
      },
      model: request.model,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await this.chat(request);
    if (response.content) {
      yield { delta: response.content, done: false };
    }
    yield { delta: '', done: true };
  }

  async embeddings(
    _input: string | string[],
    _model?: string,
  ): Promise<number[][]> {
    throw new Error(
      'Embeddings con Gemini no están habilitados; usá OpenAI para RAG',
    );
  }

  private toGeminiContents(messages: LlmMessage[]): {
    systemInstruction: string;
    contents: GeminiContent[];
  } {
    const systemParts: string[] = [];
    const contents: GeminiContent[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        if (message.content?.trim()) systemParts.push(message.content.trim());
        continue;
      }

      if (message.role === 'user') {
        const text = message.content || '';
        if (!text.trim()) continue;
        contents.push({
          role: 'user',
          parts: [{ text }],
        });
        continue;
      }

      if (message.role === 'assistant') {
        const parts: Array<Record<string, unknown>> = [];
        if (message.content?.trim()) {
          parts.push({ text: message.content });
        }

        const validCalls = (message.toolCalls ?? []).filter((call) =>
          this.isReplayableToolCall(call),
        );

        // Sin thoughtSignature Gemini rechaza el functionCall en el siguiente turno.
        // Si faltan firmas (p.ej. historial de DB), mandamos solo texto.
        const canReplayTools =
          validCalls.length > 0 &&
          validCalls.every((call) => Boolean(call.thoughtSignature));

        if (canReplayTools) {
          for (const call of validCalls) {
            const part: Record<string, unknown> = {
              functionCall: {
                name: call.name,
                args: this.safeParseObject(call.arguments),
                ...(call.id ? { id: call.id } : {}),
              },
              thoughtSignature: call.thoughtSignature,
            };
            parts.push(part);
          }
        }

        if (parts.length) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }

      if (message.role === 'tool') {
        const previous = contents[contents.length - 1];
        const previousHadSignedCall = previous?.parts?.some(
          (part) =>
            Boolean(part.functionCall) && Boolean(part.thoughtSignature),
        );
        if (!previousHadSignedCall) {
          // Historial incompleto / basura de DB: no reinyectar functionResponse huérfana
          continue;
        }

        const responsePart = {
          functionResponse: {
            name: message.name || 'tool',
            ...(message.toolCallId ? { id: message.toolCallId } : {}),
            response: {
              result: this.safeParseUnknown(message.content),
            },
          },
        };

        if (previous?.role === 'user') {
          previous.parts.push(responsePart);
        } else {
          contents.push({
            role: 'user',
            parts: [responsePart],
          });
        }
      }
    }

    return {
      systemInstruction: systemParts.join('\n\n'),
      contents,
    };
  }

  private isReplayableToolCall(call: LlmToolCall | unknown): call is LlmToolCall {
    if (!call || typeof call !== 'object') return false;
    const value = call as Partial<LlmToolCall>;
    return (
      typeof value.name === 'string' &&
      value.name.length > 0 &&
      typeof value.arguments === 'string'
    );
  }

  private extractToolCalls(response: unknown): LlmToolCall[] {
    const data = response as {
      candidates?: Array<{
        content?: { parts?: Array<Record<string, unknown>> };
      }>;
    };

    // Importante: NO usar response.functionCalls — descarta thoughtSignature del Part.
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls: LlmToolCall[] = [];

    parts.forEach((part, index) => {
      const fn = part.functionCall as
        | { id?: string; name?: string; args?: Record<string, unknown> }
        | undefined;
      if (!fn?.name) return;

      const thoughtSignature =
        typeof part.thoughtSignature === 'string'
          ? part.thoughtSignature
          : undefined;

      calls.push({
        id: fn.id || `gemini_call_${index}_${fn.name}`,
        name: fn.name,
        arguments: JSON.stringify(fn.args ?? {}),
        thoughtSignature,
      });
    });

    return calls;
  }

  private extractText(response: unknown): string | null {
    const data = response as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return text || null;
  }

  private sanitizeToolParameters(
    parameters: Record<string, unknown>,
  ): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(parameters)) as Record<
      string,
      unknown
    >;
    this.normalizeSchemaNode(cloned);
    return cloned;
  }

  private normalizeSchemaNode(node: Record<string, unknown>): void {
    if (node.exclusiveMinimum === true) {
      if (typeof node.minimum === 'number') {
        node.exclusiveMinimum = node.minimum;
        delete node.minimum;
      } else {
        delete node.exclusiveMinimum;
      }
    } else if (typeof node.exclusiveMinimum === 'boolean') {
      delete node.exclusiveMinimum;
    }

    if (node.exclusiveMaximum === true) {
      if (typeof node.maximum === 'number') {
        node.exclusiveMaximum = node.maximum;
        delete node.maximum;
      } else {
        delete node.exclusiveMaximum;
      }
    } else if (typeof node.exclusiveMaximum === 'boolean') {
      delete node.exclusiveMaximum;
    }

    // Gemini a veces falla con additionalProperties: {} (objeto vacío)
    if (
      node.additionalProperties &&
      typeof node.additionalProperties === 'object' &&
      !Array.isArray(node.additionalProperties) &&
      Object.keys(node.additionalProperties as object).length === 0
    ) {
      node.additionalProperties = true;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            this.normalizeSchemaNode(item as Record<string, unknown>);
          }
        }
      } else if (value && typeof value === 'object') {
        this.normalizeSchemaNode(value as Record<string, unknown>);
      }
    }
  }

  private safeParseObject(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      this.logger.warn('No se pudo parsear arguments de tool call Gemini');
      return {};
    }
  }

  private safeParseUnknown(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}
