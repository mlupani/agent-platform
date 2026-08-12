import { AnalyticsService } from './analytics.service';

describe('AnalyticsService.dashboard', () => {
  const prisma = {
    conversation: {
      count: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    appointment: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    lead: { count: jest.fn() },
    agentExecution: { aggregate: jest.fn() },
    message: { aggregate: jest.fn() },
    business: { count: jest.fn() },
    generatedContent: { count: jest.fn() },
    contentAsset: { groupBy: jest.fn() },
  };

  const businesses = {
    getCurrent: jest.fn(async () => ({
      id: 'biz-1',
      name: 'Demo',
      timezone: 'America/Argentina/Buenos_Aires',
    })),
  };

  const service = new AnalyticsService(prisma as never, businesses as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.conversation.count.mockResolvedValue(2);
    prisma.conversation.groupBy
      .mockResolvedValueOnce([
        { status: 'AI', _count: 3 },
        { status: 'WAITING_HUMAN', _count: 1 },
        { status: 'HUMAN', _count: 1 },
      ])
      .mockResolvedValueOnce([
        { channel: 'WHATSAPP', _count: 4 },
        { channel: 'INSTAGRAM', _count: 1 },
      ]);
    prisma.conversation.aggregate.mockResolvedValue({
      _sum: { unreadCount: 7 },
    });
    prisma.appointment.count.mockResolvedValue(3);
    prisma.lead.count.mockResolvedValue(5);
    prisma.agentExecution.aggregate.mockResolvedValue({
      _count: 10,
      _sum: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.12 },
      _avg: { durationMs: 900 },
    });
    prisma.message.aggregate.mockResolvedValue({
      _avg: { latencyMs: 1200 },
    });
    prisma.conversation.findMany.mockResolvedValue([]);
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.generatedContent.count.mockResolvedValue(4);
    prisma.contentAsset.groupBy.mockResolvedValue([
      { type: 'IMAGE', _count: 6 },
      { type: 'VIDEO', _count: 1 },
    ]);
  });

  it('returns business-scoped KPIs with handoffs and channel mix', async () => {
    const result = await service.dashboard();

    expect(result.business.name).toBe('Demo');
    expect(result.metrics.conversationsToday).toBe(2);
    expect(result.metrics.handoffsOpen).toBe(2);
    expect(result.metrics.openConversations).toBe(5);
    expect(result.metrics.unreadMessages).toBe(7);
    expect(result.metrics.avgLatencyMs).toBe(1200);
    expect(result.metrics.contentGeneratedMonth).toBe(4);
    expect(result.metrics.contentPhotosMonth).toBe(6);
    expect(result.metrics.contentVideosMonth).toBe(1);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          hiddenAt: null,
          channel: { notIn: ['PLAYGROUND', 'WEB'] },
        }),
      }),
    );
    expect(prisma.conversation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: { notIn: ['PLAYGROUND', 'WEB'] },
        }),
      }),
    );
    expect(result.channelMix).toEqual(
      expect.arrayContaining([
        { channel: 'WHATSAPP', count: 4 },
        { channel: 'INSTAGRAM', count: 1 },
      ]),
    );
  });
});
