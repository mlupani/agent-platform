import { ExecutionsService } from './executions.service';

describe('ExecutionsService', () => {
  const prisma = {
    agentExecution: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const service = new ExecutionsService(prisma as never, businesses as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists recent executions for current business', async () => {
    prisma.agentExecution.findMany.mockResolvedValue([
      {
        id: 'exec-1',
        success: true,
        _count: { toolExecutions: 2 },
      },
    ]);

    const rows = await service.list({ limit: 10 });
    expect(prisma.agentExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        take: 10,
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it('gets execution detail with tools', async () => {
    prisma.agentExecution.findFirst.mockResolvedValue({
      id: 'exec-1',
      toolExecutions: [{ tool: 'getOpeningHours', success: true }],
    });
    const detail = await service.get('exec-1');
    expect(detail.toolExecutions[0].tool).toBe('getOpeningHours');
  });
});
