import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { PgVectorStore } from '../vector-store/pgvector.store';
import type { VectorMatch } from '../vector-store/vector-store.interface';
import { ChunkerService } from './chunker.service';
import { LoaderRegistry } from './loaders/loader.registry';

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0.55;

@Injectable()
export class RagService {
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
  }): Promise<{ chunks: number }> {
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
  }): Promise<{ chunks: number }> {
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

      const embeddings = await this.embeddings.embed(chunks);
      const withVectors = created
        .map((chunk, index) => ({
          id: chunk.id,
          businessId: params.businessId,
          content: chunk.content,
          embedding: embeddings[index] ?? [],
          metadata: { documentId: document.id },
        }))
        .filter((row) => row.embedding.length > 0);

      if (!withVectors.length) {
        throw new Error(
          'No se pudieron generar embeddings (revisá OPENAI_API_KEY / créditos, o usá AGENT_LLM_MODE=openai)',
        );
      }

      await this.vectors.upsertChunks(withVectors);

      await this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'ready' },
      });

      return { chunks: created.length };
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
      if (!embedding?.length) return [];

      const matches = await this.vectors.searchChunks({
        businessId: params.businessId,
        embedding,
        topK: params.topK ?? DEFAULT_TOP_K,
        filters: {
          category: params.category,
          knowledgeBaseId: params.knowledgeBaseId,
        },
      });

      const minScore = params.minScore ?? DEFAULT_MIN_SCORE;
      return matches.filter((match) => match.score >= minScore);
    } catch {
      return [];
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
}
