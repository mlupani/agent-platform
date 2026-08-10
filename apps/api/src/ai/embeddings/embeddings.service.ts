import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderFactory } from '../providers/llm-provider.factory';
import { LlmRoutingService } from '../providers/llm-routing.service';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    private readonly providers: LlmProviderFactory,
    private readonly routing: LlmRoutingService,
  ) {}

  async embed(
    texts: string | string[],
    provider = 'openai',
  ): Promise<number[][]> {
    const count = Array.isArray(texts) ? texts.length : 1;

    // Los vectores en DB son OpenAI 1536-dim. En modo free el chat usa Gemini
    // y no hay créditos de OpenAI → omitimos embeddings (RAG/memoria semántica).
    if (this.routing.getMode() === 'free' && provider === 'openai') {
      this.logger.debug(
        'Skipping OpenAI embeddings (AGENT_LLM_MODE=free); RAG/memoria semántica desactivados',
      );
      return Array.from({ length: count }, () => []);
    }

    try {
      const llm = this.providers.get(provider);
      return await llm.embeddings(texts);
    } catch (error) {
      this.logger.warn(
        `Embeddings failed (${provider}): ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return Array.from({ length: count }, () => []);
    }
  }
}
