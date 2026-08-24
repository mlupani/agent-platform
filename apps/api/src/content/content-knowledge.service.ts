import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LlmRoutingService } from '../ai/providers/llm-routing.service';

export const CONTENT_KNOWLEDGE_BASE_NAME = 'Lineamientos de contenido';

const MAX_CONTEXT_CHARS = 8_000;
const MAX_DOC_CHARS = 2_500;

@Injectable()
export class ContentKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly knowledge: KnowledgeService,
    private readonly routing: LlmRoutingService,
  ) {}

  async getWorkspace() {
    const businessId = await this.businesses.getCurrentId();
    const knowledgeBase = await this.ensureBase(businessId);
    const documents = await this.prisma.document.findMany({
      where: { knowledgeBaseId: knowledgeBase.id, businessId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });

    return {
      businessId,
      vectorsEnabled: this.routing.getMode() !== 'free',
      knowledgeBase: {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        documentCount: documents.length,
        documents: documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          source: doc.source,
          content: doc.content,
          category: doc.category,
          status: doc.status,
          mimeType: doc.mimeType,
          chunkCount: doc._count.chunks,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          isNote:
            doc.category === 'content' ||
            doc.source === 'content-manual' ||
            Boolean(doc.content && !doc.mimeType?.includes('pdf')),
        })),
      },
    };
  }

  /** Texto consolidado para inyectar en prompts de generación de contenido. */
  async getPromptContext(businessId: string): Promise<string> {
    const base = await this.prisma.knowledgeBase.findFirst({
      where: { businessId, name: CONTENT_KNOWLEDGE_BASE_NAME },
    });
    if (!base) return '';

    const documents = await this.prisma.document.findMany({
      where: {
        knowledgeBaseId: base.id,
        businessId,
        status: { in: ['ready', 'pending'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        title: true,
        content: true,
        category: true,
        chunks: {
          orderBy: { page: 'asc' },
          take: 12,
          select: { content: true },
        },
      },
    });

    if (!documents.length) return '';

    const parts: string[] = [];
    let used = 0;
    for (const doc of documents) {
      const fromContent = (doc.content ?? '').trim();
      const fromChunks = doc.chunks
        .map((chunk) => chunk.content.trim())
        .filter(Boolean)
        .join('\n\n');
      const body = fromContent || fromChunks;
      if (!body) continue;
      const clipped =
        body.length > MAX_DOC_CHARS
          ? `${body.slice(0, MAX_DOC_CHARS).trim()}…`
          : body;
      const block = `### ${doc.title}\n${clipped}`;
      if (used + block.length > MAX_CONTEXT_CHARS) break;
      parts.push(block);
      used += block.length;
    }

    return parts.join('\n\n');
  }

  async createNote(input: { title: string; content: string; category?: string }) {
    const businessId = await this.businesses.getCurrentId();
    const base = await this.ensureBase(businessId);
    return this.knowledge.createFaq({
      title: input.title,
      content: input.content,
      category: input.category ?? 'content',
      knowledgeBaseId: base.id,
    });
  }

  async updateNote(
    documentId: string,
    input: { title?: string; content?: string; category?: string },
  ) {
    await this.assertContentDocument(documentId);
    return this.knowledge.updateFaq(documentId, {
      title: input.title,
      content: input.content,
      category: input.category ?? 'content',
    });
  }

  async deleteDocument(documentId: string) {
    await this.assertContentDocument(documentId);
    return this.knowledge.deleteDocument(documentId);
  }

  async reindex(documentId: string) {
    await this.assertContentDocument(documentId);
    return this.knowledge.reindex(documentId);
  }

  async upload(file: Express.Multer.File, title?: string) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío');
    }
    const businessId = await this.businesses.getCurrentId();
    const base = await this.ensureBase(businessId);
    const document = await this.knowledge.createDocument({
      knowledgeBaseId: base.id,
      businessId,
      title: title?.trim() || file.originalname,
      source: file.originalname,
      mimeType: file.mimetype,
      category: 'content',
    });
    const result = await this.knowledge.ingest(
      document.id,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return {
      document: await this.knowledge.getDocument(document.id),
      ...result,
    };
  }

  private async ensureBase(businessId: string) {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: { businessId, name: CONTENT_KNOWLEDGE_BASE_NAME },
    });
    if (existing) return existing;

    return this.prisma.knowledgeBase.create({
      data: {
        businessId,
        name: CONTENT_KNOWLEDGE_BASE_NAME,
        description:
          'Público, tono, tipos de contenido (educativo / comedia / venta) y lineamientos del negocio para el creador de contenido. No se usa en el chat del agente.',
      },
    });
  }

  private async assertContentDocument(documentId: string) {
    const businessId = await this.businesses.getCurrentId();
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, businessId },
      include: { knowledgeBase: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.knowledgeBase.name !== CONTENT_KNOWLEDGE_BASE_NAME) {
      throw new BadRequestException(
        'Este documento no pertenece a los lineamientos de contenido',
      );
    }
    return document;
  }
}
