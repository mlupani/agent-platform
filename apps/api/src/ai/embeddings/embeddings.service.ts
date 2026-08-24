import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LlmProviderFactory } from '../providers/llm-provider.factory';
import { LlmRoutingService } from '../providers/llm-routing.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    private readonly providers: LlmProviderFactory,
    private readonly routing: LlmRoutingService,
    private readonly redis: RedisService,
  ) {}

  async embed(
    texts: string | string[],
    provider = 'openai',
  ): Promise<number[][]> {
    const count = Array.isArray(texts) ? texts.length : 1;
    const arr = Array.isArray(texts) ? texts : [texts];

    // Los vectores en DB son OpenAI 1536-dim. En modo free el chat usa Gemini
    // y no hay créditos de OpenAI → omitimos embeddings (RAG/memoria semántica).
    if (this.routing.getMode() === 'free' && provider === 'openai') {
      this.logger.debug(
        'Skipping OpenAI embeddings (AGENT_LLM_MODE=free); RAG/memoria semántica desactivados',
      );
      return Array.from({ length: count }, () => []);
    }

    // Cache por texto normalizado en Redis (TTL 1h) — ahorra ~500-1700ms en preguntas repetidas
    const uncached: Array<{ idx: number; text: string; key: string }> = [];
    const results: Array<number[] | null> = Array(count).fill(null);
    for (let i = 0; i < arr.length; i++) {
      const norm = arr[i].trim().toLowerCase();
      if (!norm) {
        results[i] = [];
        continue;
      }
      const hash = createHash('sha256').update(norm).digest('hex').slice(0, 16);
      const key = `emb:${provider}:${hash}`;
      uncached.push({ idx: i, text: arr[i], key });
    }

    // Intentar hits en paralelo
    await Promise.all(
      uncached.map(async (item) => {
        try {
          const cached = await this.redis.get(item.key);
          if (cached) {
            const vec = JSON.parse(cached) as number[];
            if (Array.isArray(vec) && vec.length) {
              results[item.idx] = vec;
              this.logger.debug(`Embeddings cache hit ${item.key.slice(0, 12)}`);
            }
          }
        } catch {}
      }),
    );

    const toFetch = uncached.filter((u) => results[u.idx] === null);
    if (!toFetch.length) return results as number[][];

    try {
      const llm = this.providers.get(provider);
      const fetched = await llm.embeddings(toFetch.map((u) => u.text));
      for (let i = 0; i < toFetch.length; i++) {
        const vec = fetched[i] ?? [];
        results[toFetch[i].idx] = vec;
        if (vec.length) {
          const key = toFetch[i].key;
          this.redis.set(key, JSON.stringify(vec), 3600).catch(() => {});
          this.logger.debug(`Embeddings cache miss ${key.slice(0, 12)} → cached 1h`);
        }
      }
      return results as number[][];
    } catch (error) {
      this.logger.warn(
        `Embeddings failed (${provider}): ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return results.map((r) => r ?? []) as number[][];
    }
  }
}
