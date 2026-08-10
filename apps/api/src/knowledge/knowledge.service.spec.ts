import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService', () => {
  const prisma = {
    knowledgeBase: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    document: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    agentConfig: { findFirst: jest.fn(), update: jest.fn() },
  };
  const rag = {
    ingestText: jest.fn(async () => ({ chunks: 2 })),
    reindexDocument: jest.fn(async () => ({ chunks: 2 })),
  };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };

  const service = new KnowledgeService(
    prisma as never,
    rag as never,
    businesses as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates FAQ and ingests text', async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      {
        id: 'kb-1',
        businessId: 'biz-1',
        name: 'KB',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { documents: 0 },
        documents: [],
      },
    ]);
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1',
      businessId: 'biz-1',
    });
    prisma.document.create.mockResolvedValue({
      id: 'doc-1',
      businessId: 'biz-1',
      knowledgeBaseId: 'kb-1',
      title: 'Políticas',
      source: 'faq-manual',
      category: 'faq',
      content: 'No compartimos datos.',
    });
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      businessId: 'biz-1',
      title: 'Políticas',
      source: 'faq-manual',
      content: 'No compartimos datos.',
      category: 'faq',
      status: 'ready',
      mimeType: 'text/markdown',
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { chunks: 2 },
    });

    const result = await service.createFaq({
      title: 'Políticas',
      content: 'No compartimos datos.',
    });

    expect(rag.ingestText).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        text: 'No compartimos datos.',
        category: 'faq',
      }),
    );
    expect(result.chunks).toBe(2);
    expect(result.document.id).toBe('doc-1');
  });
});
