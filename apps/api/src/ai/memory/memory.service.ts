import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_MEMORY_STRATEGY } from '../../common/constants';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { PgVectorStore } from '../vector-store/pgvector.store';
import type { LlmMessage } from '../providers/llm-provider.interface';

export interface MemoryStrategy {
  recentMessages: number;
  includeSummary: boolean;
  semanticTopK: number;
}

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: PgVectorStore,
  ) {}

  parseStrategy(raw: unknown): MemoryStrategy {
    const value = (raw ?? {}) as Partial<MemoryStrategy>;
    return {
      recentMessages:
        value.recentMessages ?? DEFAULT_MEMORY_STRATEGY.recentMessages,
      includeSummary:
        value.includeSummary ?? DEFAULT_MEMORY_STRATEGY.includeSummary,
      semanticTopK: value.semanticTopK ?? DEFAULT_MEMORY_STRATEGY.semanticTopK,
    };
  }

  async getRecentMessages(
    conversationId: string,
    businessId: string,
    limit: number,
  ): Promise<LlmMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId, businessId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages.reverse().map((message) => ({
      role: message.role as LlmMessage['role'],
      content: message.content,
      toolCallId: message.toolCallId ?? undefined,
      // toolCalls en DB guarda metadata de ejecución (no el formato LLM) y sin
      // thoughtSignature de Gemini → reinyectarlos rompe el siguiente turno.
      toolCalls: undefined,
    }));
  }

  private isTrivialQuery(query: string): boolean {
    const s = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    if (s.length < 4) return true;
    if (s.length <= 14 && /^(hola|buenas|buen dia|buenas tardes|buenas noches|chau|gracias|ok|dale|buen dia!?)[!?.\s]*$/.test(s)) return true;
    if (/^(hola|gracias|chau|ok|dale)[!?.\s]*$/i.test(s)) return true;
    return false;
  }

  async getLongTermContext(params: {
    businessId: string;
    query: string;
    userId?: string;
    topK: number;
  }): Promise<string> {
    if (params.topK <= 0) return '';
    if (this.isTrivialQuery(params.query)) return '';
    try {
      const [embedding] = await this.embeddings.embed(params.query);
      if (!embedding?.length) return '';
      const matches = await this.vectors.searchMemories({
        businessId: params.businessId,
        embedding,
        topK: params.topK,
        filters: { userId: params.userId },
      });
      return matches.map((match) => `- ${match.content}`).join('\n');
    } catch {
      return '';
    }
  }

  async remember(params: {
    businessId: string;
    conversationId?: string;
    userId?: string;
    key?: string;
    content: string;
  }): Promise<void> {
    const memory = await this.prisma.memory.create({
      data: {
        businessId: params.businessId,
        conversationId: params.conversationId,
        userId: params.userId,
        type: 'LONG_TERM',
        key: params.key,
        content: params.content,
      },
    });

    try {
      const [embedding] = await this.embeddings.embed(params.content);
      if (embedding?.length) {
        await this.vectors.upsertMemories([
          {
            id: memory.id,
            businessId: params.businessId,
            content: params.content,
            embedding,
          },
        ]);
      }
    } catch {
      // Embeddings are optional during local/dev without API key.
    }
  }
}
