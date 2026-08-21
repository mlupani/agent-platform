import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { LlmRoutingService } from '../ai/providers/llm-routing.service';
import { RagService } from '../ai/rag/rag.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
    private readonly businesses: BusinessesService,
    private readonly routing: LlmRoutingService,
  ) {}

  async getWorkspace() {
    const businessId = await this.businesses.getCurrentId();
    const bases = await this.prisma.knowledgeBase.findMany({
      where: { businessId },
      include: {
        _count: { select: { documents: true } },
        documents: {
          orderBy: { updatedAt: 'desc' },
          include: { _count: { select: { chunks: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let knowledgeBase = bases[0];
    if (!knowledgeBase) {
      knowledgeBase = await this.prisma.knowledgeBase.create({
        data: {
          businessId,
          name: 'Conocimiento principal',
          description: 'Información que conoce tu asistente',
        },
        include: {
          _count: { select: { documents: true } },
          documents: {
            orderBy: { updatedAt: 'desc' },
            include: { _count: { select: { chunks: true } } },
          },
        },
      });

      const defaultAgent = await this.prisma.agentConfig.findFirst({
        where: { businessId, isDefault: true },
      });
      if (defaultAgent && !defaultAgent.knowledgeBaseId) {
        await this.prisma.agentConfig.update({
          where: { id: defaultAgent.id },
          data: { knowledgeBaseId: knowledgeBase.id },
        });
      }
    }

    return {
      businessId,
      vectorsEnabled: this.routing.getMode() !== 'free',
      knowledgeBase: this.toPublicBase(knowledgeBase),
    };
  }

  listBases(businessId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { businessId },
      include: { _count: { select: { documents: true } } },
    });
  }

  createBase(data: { businessId: string; name: string; description?: string }) {
    return this.prisma.knowledgeBase.create({ data });
  }

  listDocuments(knowledgeBaseId: string) {
    return this.prisma.document.findMany({
      where: { knowledgeBaseId },
      include: { _count: { select: { chunks: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getDocument(documentId: string) {
    const businessId = await this.businesses.getCurrentId();
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, businessId },
      include: { _count: { select: { chunks: true } } },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    return document;
  }

  async createDocument(data: {
    knowledgeBaseId: string;
    title: string;
    source: string;
    mimeType?: string;
    category?: string;
    content?: string;
    businessId?: string;
  }) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: data.knowledgeBaseId },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    if (data.businessId && kb.businessId !== data.businessId) {
      throw new NotFoundException('Knowledge base not found for business');
    }

    return this.prisma.document.create({
      data: {
        knowledgeBaseId: kb.id,
        businessId: kb.businessId,
        title: data.title,
        source: data.source,
        mimeType: data.mimeType,
        category: data.category,
        content: data.content,
      },
    });
  }

  async createFaq(input: {
    title: string;
    content: string;
    category?: string;
    knowledgeBaseId?: string;
  }) {
    const { knowledgeBase } = await this.getWorkspace();
    const kbId = input.knowledgeBaseId ?? knowledgeBase.id;
    const document = await this.createDocument({
      knowledgeBaseId: kbId,
      title: input.title.trim(),
      source: 'faq-manual',
      mimeType: 'text/markdown',
      category: input.category ?? 'faq',
      content: input.content,
    });

    const result = await this.rag.ingestText({
      documentId: document.id,
      businessId: document.businessId,
      text: input.content,
      source: document.source,
      category: document.category ?? 'faq',
    });

    return { document: await this.getDocument(document.id), ...result };
  }

  async updateFaq(
    documentId: string,
    input: { title?: string; content?: string; category?: string },
  ) {
    const document = await this.getDocument(documentId);
    const content = input.content ?? document.content;
    if (!content?.trim()) {
      throw new BadRequestException('El contenido no puede estar vacío');
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: {
        title: input.title?.trim() || document.title,
        category: input.category ?? document.category,
        content,
      },
    });

    const result = await this.rag.ingestText({
      documentId: document.id,
      businessId: document.businessId,
      text: content,
      source: document.source,
      category: input.category ?? document.category ?? undefined,
    });

    return { document: await this.getDocument(document.id), ...result };
  }

  async deleteDocument(documentId: string) {
    const document = await this.getDocument(documentId);
    await this.prisma.document.delete({ where: { id: document.id } });
    return { ok: true };
  }

  async reindex(documentId: string) {
    const document = await this.getDocument(documentId);
    const result = await this.rag.reindexDocument(
      document.id,
      document.businessId,
    );
    return { document: await this.getDocument(document.id), ...result };
  }

  async ingest(
    documentId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found');
    return this.rag.ingestDocument({
      documentId: document.id,
      businessId: document.businessId,
      buffer,
      filename,
      mimeType: mimeType || document.mimeType || 'text/plain',
      category: document.category ?? undefined,
    });
  }

  private toPublicBase(base: {
    id: string;
    businessId: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { documents: number };
    documents: Array<{
      id: string;
      title: string;
      source: string;
      content: string | null;
      category: string | null;
      status: string;
      mimeType: string | null;
      createdAt: Date;
      updatedAt: Date;
      _count: { chunks: number };
    }>;
  }) {
    return {
      id: base.id,
      businessId: base.businessId,
      name: base.name,
      description: base.description,
      documentCount: base._count.documents,
      documents: base.documents.map((doc) => ({
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
        isFaq:
          doc.category === 'faq' ||
          doc.source === 'faq-manual' ||
          Boolean(doc.content && !doc.mimeType?.includes('pdf')),
      })),
    };
  }
}
