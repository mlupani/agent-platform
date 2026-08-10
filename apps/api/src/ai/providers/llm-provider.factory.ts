import { BadRequestException, Injectable } from '@nestjs/common';
import type { LlmProviderName } from '../../common/constants';
import type { LLMProvider } from './llm-provider.interface';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';

@Injectable()
export class LlmProviderFactory {
  constructor(
    private readonly openai: OpenAIProvider,
    private readonly gemini: GeminiProvider,
  ) {}

  get(name: string): LLMProvider {
    const provider = name as LlmProviderName;
    if (provider === 'openai') return this.openai;
    if (provider === 'gemini') return this.gemini;

    throw new BadRequestException(
      `LLM provider "${name}" is not implemented yet. Supported: openai, gemini.`,
    );
  }
}
