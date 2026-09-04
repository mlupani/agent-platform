import { RequestHumanAssistanceTool } from './request-human-assistance.tool';

describe('RequestHumanAssistanceTool', () => {
  const prisma = {
    conversation: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  const tool = new RequestHumanAssistanceTool(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('deriva a WAITING_HUMAN sin pisar la metadata existente de la conversación', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      metadata: { externalUserId: 'ig_123', reopenedAt: '2026-09-03T10:00:00.000Z' },
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });

    const result = await tool.execute(
      { reason: 'la clienta lo pidió' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'INSTAGRAM',
        enabledTools: ['requestHumanAssistance'],
      },
    );

    expect(result.success).toBe(true);
    const data = prisma.conversation.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('WAITING_HUMAN');
    expect(data.metadata).toEqual(
      expect.objectContaining({
        externalUserId: 'ig_123',
        reopenedAt: '2026-09-03T10:00:00.000Z',
        handoffReason: 'la clienta lo pidió',
        statusReason: 'agent_handoff',
      }),
    );
  });
});
