import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  VectorMatch,
  VectorRecord,
  VectorSearchOptions,
  VectorStore,
} from './vector-store.interface';

@Injectable()
export class PgVectorStore implements VectorStore {
  constructor(private readonly prisma: PrismaService) {}

  async upsertChunks(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      const embedding = this.toVectorLiteral(record.embedding);
      await this.prisma.$executeRaw`
        UPDATE document_chunks
        SET embedding = ${embedding}::vector
        WHERE id = ${record.id} AND "businessId" = ${record.businessId}
      `;
    }
  }

  async searchChunks(options: VectorSearchOptions): Promise<VectorMatch[]> {
    const topK = options.topK ?? 5;
    const embedding = this.toVectorLiteral(options.embedding);
    const category = options.filters?.category ?? null;
    const documentId = options.filters?.documentId ?? null;
    const knowledgeBaseId = options.filters?.knowledgeBaseId ?? null;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        source: string | null;
        category: string | null;
        page: number | null;
        documentId: string;
        title: string | null;
        score: number;
      }>
    >(Prisma.sql`
      SELECT
        c.id,
        c.content,
        c.source,
        c.category,
        c.page,
        c."documentId",
        d.title,
        1 - (c.embedding <=> ${embedding}::vector) AS score
      FROM document_chunks c
      INNER JOIN documents d ON d.id = c."documentId"
      WHERE c."businessId" = ${options.businessId}
        AND c.embedding IS NOT NULL
        AND (${category}::text IS NULL OR c.category = ${category})
        AND (${documentId}::text IS NULL OR c."documentId" = ${documentId})
        AND (${knowledgeBaseId}::text IS NULL OR d."knowledgeBaseId" = ${knowledgeBaseId})
      ORDER BY c.embedding <=> ${embedding}::vector
      LIMIT ${topK}
    `);

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      score: Number(row.score),
      metadata: {
        source: row.source,
        category: row.category,
        page: row.page,
        documentId: row.documentId,
        title: row.title,
      },
    }));
  }

  async deleteChunksByDocument(
    businessId: string,
    documentId: string,
  ): Promise<void> {
    await this.prisma.documentChunk.deleteMany({
      where: { businessId, documentId },
    });
  }

  async upsertMemories(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      const embedding = this.toVectorLiteral(record.embedding);
      await this.prisma.$executeRaw`
        UPDATE memories
        SET embedding = ${embedding}::vector
        WHERE id = ${record.id} AND "businessId" = ${record.businessId}
      `;
    }
  }

  async searchMemories(options: VectorSearchOptions): Promise<VectorMatch[]> {
    const topK = options.topK ?? 3;
    const embedding = this.toVectorLiteral(options.embedding);
    const userId = options.filters?.userId ?? null;

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; content: string; key: string | null; score: number }>
    >(Prisma.sql`
      SELECT
        m.id,
        m.content,
        m.key,
        1 - (m.embedding <=> ${embedding}::vector) AS score
      FROM memories m
      WHERE m."businessId" = ${options.businessId}
        AND m.embedding IS NOT NULL
        AND m.type = 'LONG_TERM'
        AND (${userId}::text IS NULL OR m."userId" = ${userId})
      ORDER BY m.embedding <=> ${embedding}::vector
      LIMIT ${topK}
    `);

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      score: Number(row.score),
      metadata: { key: row.key },
    }));
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
