import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { PgVectorStore } from '../vector-store/pgvector.store';
import type { VectorMatch } from '../vector-store/vector-store.interface';
import { ChunkerService } from './chunker.service';
import { LoaderRegistry } from './loaders/loader.registry';

const DEFAULT_TOP_K = 8;
const DEFAULT_MIN_SCORE = 0.28;
const QUERY_STOPWORDS = new Set([
  'cual',
  'cuál',
  'como',
  'cómo',
  'que',
  'qué',
  'donde',
  'dónde',
  'cuando',
  'cuándo',
  'este',
  'esta',
  'esto',
  'esos',
  'esas',
  'para',
  'por',
  'con',
  'sin',
  'una',
  'uno',
  'unos',
  'unas',
  'del',
  'los',
  'las',
  'the',
  'and',
]);

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunker: ChunkerService,
    private readonly loaders: LoaderRegistry,
    private readonly embeddings: EmbeddingsService,
    private readonly vectors: PgVectorStore,
  ) {}

  async ingestDocument(params: {
    documentId: string;
    businessId: string;
    buffer: Buffer;
    filename: string;
    mimeType: string;
    category?: string;
  }): Promise<{ chunks: number; indexed: boolean }> {
    const loader = this.loaders.resolve(params.mimeType, params.filename);
    const loaded = await loader.load(params.buffer, params.filename);
    return this.ingestText({
      documentId: params.documentId,
      businessId: params.businessId,
      text: loaded.text,
      source: params.filename,
      category: params.category,
      metadata: loaded.metadata,
    });
  }

  async ingestText(params: {
    documentId: string;
    businessId: string;
    text: string;
    source?: string;
    category?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ chunks: number; indexed: boolean }> {
    const document = await this.prisma.document.findFirst({
      where: { id: params.documentId, businessId: params.businessId },
    });
    if (!document) {
      throw new Error('Document not found for business');
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: {
        status: 'processing',
        content: params.text,
        ...(params.source ? { source: params.source } : {}),
      },
    });

    try {
      const chunks = this.chunker.chunk(params.text);
      if (!chunks.length) {
        throw new Error('El contenido está vacío');
      }

      await this.vectors.deleteChunksByDocument(params.businessId, document.id);

      const created = await Promise.all(
        chunks.map((content, index) =>
          this.prisma.documentChunk.create({
            data: {
              documentId: document.id,
              businessId: params.businessId,
              content,
              source: params.source ?? document.source,
              category: params.category ?? document.category,
              page: index + 1,
              metadata: params.metadata as object | undefined,
            },
          }),
        ),
      );

      const title = document.title?.trim();
      const embeddings = await this.embeddings.embed(
        created.map((chunk) =>
          title ? `${title}\n${chunk.content}` : chunk.content,
        ),
      );
      const withVectors = created
        .map((chunk, index) => ({
          id: chunk.id,
          businessId: params.businessId,
          content: chunk.content,
          embedding: embeddings[index] ?? [],
          metadata: { documentId: document.id },
        }))
        .filter((row) => row.embedding.length > 0);

      if (withVectors.length) {
        await this.vectors.upsertChunks(withVectors);
      }

      await this.prisma.document.update({
        where: { id: document.id },
        data: { status: withVectors.length ? 'ready' : 'pending' },
      });

      return { chunks: created.length, indexed: withVectors.length > 0 };
    } catch (error) {
      await this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'failed' },
      });
      throw error;
    }
  }

  async reindexDocument(documentId: string, businessId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, businessId },
    });
    if (!document) throw new Error('Document not found');
    if (!document.content?.trim()) {
      throw new Error(
        'No hay texto guardado para reindexar. Editá el contenido o volvé a subir el archivo.',
      );
    }
    return this.ingestText({
      documentId: document.id,
      businessId,
      text: document.content,
      source: document.source,
      category: document.category ?? undefined,
    });
  }

  async search(params: {
    businessId: string;
    query: string;
    topK?: number;
    minScore?: number;
    category?: string;
    knowledgeBaseId?: string;
  }): Promise<VectorMatch[]> {
    try {
      const [embedding] = await this.embeddings.embed(params.query);
      const vectorMatches =
        embedding?.length > 0
          ? await this.vectors.searchChunks({
              businessId: params.businessId,
              embedding,
              topK: params.topK ?? DEFAULT_TOP_K,
              filters: {
                category: params.category,
                knowledgeBaseId: params.knowledgeBaseId,
              },
            })
          : [];

      const minScore = params.minScore ?? DEFAULT_MIN_SCORE;
      const semantic = vectorMatches.filter((match) => match.score >= minScore);
      const lexical = await this.searchByKeywords(params);
      return this.mergeMatches(semantic, lexical, params.topK ?? DEFAULT_TOP_K);
    } catch (error) {
      this.logger.warn(
        `RAG search failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return this.searchByKeywords(params);
    }
  }

  formatContext(matches: VectorMatch[]): string {
    if (!matches.length) return '';
    return matches
      .map((match, index) => {
        const title =
          (match.metadata.title as string | undefined) ||
          (match.metadata.source as string | undefined) ||
          `Nota ${index + 1}`;
        return `• ${title}\n${match.content}`;
      })
      .join('\n\n');
  }

  private async searchByKeywords(params: {
    businessId: string;
    query: string;
    topK?: number;
    category?: string;
    knowledgeBaseId?: string;
  }): Promise<VectorMatch[]> {
    const tokens = this.keywordTokens(params.query);
    if (!tokens.length) return [];

    const rows = await this.prisma.documentChunk.findMany({
      where: {
        businessId: params.businessId,
        ...(params.category ? { category: params.category } : {}),
        AND: tokens.map((token) => ({
          content: { contains: token, mode: 'insensitive' as const },
        })),
        document: params.knowledgeBaseId
          ? { knowledgeBaseId: params.knowledgeBaseId }
          : undefined,
      },
      include: { document: { select: { title: true } } },
      take: params.topK ?? DEFAULT_TOP_K,
    });

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      score: 0.99,
      metadata: {
        source: row.source,
        category: row.category,
        page: row.page,
        documentId: row.documentId,
        title: row.document.title,
      },
    }));
  }

  private keywordTokens(query: string): string[] {
    return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u))]
      .filter((token) => token.length >= 4 && !QUERY_STOPWORDS.has(token))
      .slice(0, 4);
  }

  private mergeMatches(
    semantic: VectorMatch[],
    lexical: VectorMatch[],
    topK: number,
  ): VectorMatch[] {
    const byId = new Map<string, VectorMatch>();
    for (const match of [...lexical, ...semantic]) {
      const prev = byId.get(match.id);
      if (!prev || match.score > prev.score) byId.set(match.id, match);
    }
    return [...byId.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
