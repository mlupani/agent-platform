import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProviderFactory } from './llm-provider.factory';
import type { LLMProvider } from './llm-provider.interface';

export interface ResolvedLlmTarget {
  providerName: string;
  model: string;
  provider: LLMProvider;
  mode: 'openai' | 'free';
  isFallback?: boolean;
}

@Injectable()
export class LlmRoutingService {
  constructor(
    private readonly env: ConfigService,
    private readonly factory: LlmProviderFactory,
  ) {}

  /** openai (default) | free (= Gemini Flash latest) */
  getMode(): 'openai' | 'free' {
    const raw = (this.env.get<string>('AGENT_LLM_MODE') || 'openai')
      .trim()
      .toLowerCase();
    if (raw === 'free' || raw === 'gemini') return 'free';
    return 'openai';
  }

  getGeminiModel(): string {
    return (
      this.env.get<string>('GEMINI_DEFAULT_MODEL') || 'gemini-flash-lite-latest'
    );
  }

  resolvePrimary(agentConfig: {
    provider: string;
    model: string;
  }): ResolvedLlmTarget {
    const mode = this.getMode();
    if (mode === 'free') {
      return {
        providerName: 'gemini',
        model: this.getGeminiModel(),
        provider: this.factory.get('gemini'),
        mode,
      };
    }

    return {
      providerName: agentConfig.provider || 'openai',
      model: agentConfig.model,
      provider: this.factory.get(agentConfig.provider || 'openai'),
      mode,
    };
  }

  resolveFallback(currentProviderName: string): ResolvedLlmTarget | null {
    const enabled =
      (this.env.get<string>('AGENT_LLM_FALLBACK_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
    if (!enabled) return null;
    if (currentProviderName === 'gemini') return null;

    const apiKey =
      this.env.get<string>('GOOGLE_GENERATIVE_AI_API_KEY') ||
      this.env.get<string>('GEMINI_API_KEY');
    if (!apiKey) return null;

    return {
      providerName: 'gemini',
      model: this.getGeminiModel(),
      provider: this.factory.get('gemini'),
      mode: this.getMode(),
      isFallback: true,
    };
  }

  isRetryableLlmError(error: unknown): boolean {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: number }).status)
        : NaN;
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code).toLowerCase()
        : '';
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error ?? '').toLowerCase();

    if ([401, 402, 403, 429, 500, 502, 503].includes(status)) return true;
    if (
      code.includes('insufficient') ||
      code.includes('quota') ||
      code.includes('rate_limit')
    ) {
      return true;
    }

    return (
      message.includes('insufficient') ||
      message.includes('quota') ||
      message.includes('billing') ||
      message.includes('credit') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('exceeded') ||
      message.includes('invalid api key') ||
      message.includes('incorrect api key') ||
      message.includes('authentication') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('fetch failed')
    );
  }
}
