import { SpendService } from './spend.service';

describe('SpendService.report', () => {
  const prisma = {
    agentExecution: { groupBy: jest.fn() },
    contentGenerationExecution: { groupBy: jest.fn() },
  };
  const businesses = {
    getCurrent: jest.fn(async () => ({
      id: 'biz-1',
      timezone: 'America/Argentina/Buenos_Aires',
    })),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'OPENAI_API_KEY') return 'sk-test';
      if (key === 'KIE_API_KEY') return 'kie-test';
      return '';
    }),
  };

  const service = new SpendService(
    prisma as never,
    businesses as never,
    config as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.agentExecution.groupBy
      .mockResolvedValueOnce([
        {
          provider: 'openai',
          _count: 2,
          _sum: { estimatedCost: 0.04, inputTokens: 1000, outputTokens: 400 },
        },
      ])
      .mockResolvedValueOnce([
        {
          provider: 'openai',
          _count: 8,
          _sum: { estimatedCost: 0.2, inputTokens: 8000, outputTokens: 2000 },
        },
        {
          provider: 'gemini',
          _count: 3,
          _sum: { estimatedCost: 0.01, inputTokens: 500, outputTokens: 200 },
        },
      ]);
    prisma.contentGenerationExecution.groupBy
      .mockResolvedValueOnce([
        {
          provider: 'kie',
          stage: 'video',
          _count: 1,
          _sum: { estimatedCost: 0.08, inputTokens: 0, outputTokens: 0 },
        },
      ])
      .mockResolvedValueOnce([
        {
          provider: 'kie',
          stage: 'video',
          _count: 2,
          _sum: { estimatedCost: 0.16, inputTokens: 0, outputTokens: 0 },
        },
        {
          provider: 'openai',
          stage: 'image',
          _count: 1,
          _sum: { estimatedCost: 0.04, inputTokens: 0, outputTokens: 0 },
        },
      ]);
  });

  it('aggregates day and month spend per billed service', async () => {
    const result = await service.report('2026-08');

    expect(result.period.month).toBe('2026-08');
    expect(result.currency).toBe('USD');
    expect(result.totals.day).toBeCloseTo(0.12);
    expect(result.totals.month).toBeCloseTo(0.41);

    const openai = result.services.find((row) => row.id === 'openai');
    expect(openai?.configured).toBe(true);
    expect(openai?.day.cost).toBeCloseTo(0.04);
    expect(openai?.month.cost).toBeCloseTo(0.24);
    expect(openai?.breakdown.map((item) => item.label)).toEqual(
      expect.arrayContaining(['Chat del agente', 'Imágenes']),
    );

    const kie = result.services.find((row) => row.id === 'kie');
    expect(kie?.month.cost).toBeCloseTo(0.16);
    expect(kie?.day.calls).toBe(1);

    const gemini = result.services.find((row) => row.id === 'gemini');
    expect(gemini?.configured).toBe(false);
    expect(gemini?.month.cost).toBeCloseTo(0.01);
  });
});
