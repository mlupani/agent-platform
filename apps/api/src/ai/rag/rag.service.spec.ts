import { RagService } from './rag.service';

describe('RagService', () => {
  const prisma = {
    document: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    documentChunk: { create: jest.fn(), findMany: jest.fn(async () => []) },
  };
  const chunker = { chunk: jest.fn(() => ['chunk-a', 'chunk-b']) };
  const loaders = {
    resolve: jest.fn(() => ({
      load: jest.fn(async () => ({ text: 'contenido demo' })),
    })),
  };
  const embeddings = {
    embed: jest.fn(async (input: string | string[]) =>
      Array.isArray(input) ? input.map(() => [0.1, 0.2]) : [[0.1, 0.2]],
    ),
  };
  const vectors = {
    deleteChunksByDocument: jest.fn(),
    upsertChunks: jest.fn(),
    searchChunks: jest.fn(async () => [
      {
        id: 'c1',
        content: 'Horario 9 a 18',
        score: 0.91,
        metadata: { source: 'faq.md', title: 'FAQ', businessId: 'biz-1' },
      },
      {
        id: 'c2',
        content: 'ruido',
        score: 0.2,
        metadata: { source: 'other.md', title: 'Other' },
      },
    ]),
  };

  const service = new RagService(
    prisma as never,
    chunker as never,
    loaders as never,
    embeddings as never,
    vectors as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    embeddings.embed.mockImplementation(async (input: string | string[]) =>
      Array.isArray(input) ? input.map(() => [0.1, 0.2]) : [[0.1, 0.2]],
    );
    vectors.searchChunks.mockResolvedValue([
      {
        id: 'c1',
        content: 'Horario 9 a 18',
        score: 0.91,
        metadata: { source: 'faq.md', title: 'FAQ', businessId: 'biz-1' },
      },
      {
        id: 'c2',
        content: 'ruido',
        score: 0.2,
        metadata: { source: 'other.md', title: 'Other' },
      },
    ]);
  });

  it('ingests a document into chunks and embeddings', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      businessId: 'biz-1',
      category: 'faq',
      source: 'faq.txt',
    });
    prisma.document.update.mockResolvedValue({});
    prisma.documentChunk.create
      .mockResolvedValueOnce({ id: 'chunk-1', content: 'chunk-a' })
      .mockResolvedValueOnce({ id: 'chunk-2', content: 'chunk-b' });

    const result = await service.ingestDocument({
      documentId: 'doc-1',
      businessId: 'biz-1',
      buffer: Buffer.from('hola'),
      filename: 'faq.txt',
      mimeType: 'text/plain',
    });

    expect(result.chunks).toBe(2);
    expect(vectors.upsertChunks).toHaveBeenCalled();
    expect(result.indexed).toBe(true);
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'ready' },
    });
  });

  it('keeps the document pending when embeddings are unavailable', async () => {
    embeddings.embed.mockResolvedValueOnce([[], []]);
    prisma.document.findFirst.mockResolvedValue({
      id: 'doc-1',
      businessId: 'biz-1',
      category: 'faq',
      source: 'faq.txt',
    });
    prisma.document.update.mockResolvedValue({});
    prisma.documentChunk.create
      .mockResolvedValueOnce({ id: 'chunk-1', content: 'chunk-a' })
      .mockResolvedValueOnce({ id: 'chunk-2', content: 'chunk-b' });

    const result = await service.ingestText({
      documentId: 'doc-1',
      businessId: 'biz-1',
      text: 'contenido',
    });

    expect(result.chunks).toBe(2);
    expect(result.indexed).toBe(false);
    expect(vectors.upsertChunks).not.toHaveBeenCalled();
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'pending' },
    });
  });

  it('filters low scores and formats context without jargon', async () => {
    const matches = await service.search({
      businessId: 'biz-1',
      query: 'horario',
      knowledgeBaseId: 'kb-1',
      minScore: 0.55,
    });
    expect(matches).toHaveLength(1);
    expect(vectors.searchChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeBaseId: 'kb-1' }),
      }),
    );
    const context = service.formatContext(matches);
    expect(context).toContain('FAQ');
    expect(context).toContain('Horario 9 a 18');
    expect(context).not.toContain('score=');
    expect(context).not.toContain('embeddings');
  });
});
