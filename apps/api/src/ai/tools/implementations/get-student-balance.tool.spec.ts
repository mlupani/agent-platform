import { GetStudentBalanceTool } from './get-student-balance.tool';

describe('GetStudentBalanceTool', () => {
  const packs = { getBalance: jest.fn() };
  const prisma: any = {
    user: { findFirst: jest.fn() },
    conversation: { findFirst: jest.fn() },
  };
  const makeup = { countForMonth: jest.fn() };
  const tool = new GetStudentBalanceTool(
    packs as never,
    prisma as never,
    makeup as never,
  );

  const context = {
    businessId: 'biz-1',
    conversationId: 'conv-1',
    channel: 'PLAYGROUND' as never,
    enabledTools: ['consultar_saldo_clases'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    packs.getBalance.mockResolvedValue({
      studentId: 'u1',
      studentName: 'Ana',
      availableClasses: 3,
      hasAvailableClasses: true,
      activePacks: [],
      allPacks: [],
    });
  });

  it('informa cuántos recuperos lleva la alumna en el mes', async () => {
    makeup.countForMonth.mockResolvedValue(2);

    const result = await tool.execute({ studentId: 'u1' }, context as never);

    expect(result.success).toBe(true);
    expect((result.data as any).makeupsThisMonth).toBe(2);
  });

  it('informa 0 recuperos cuando la alumna no usó ninguno', async () => {
    makeup.countForMonth.mockResolvedValue(0);

    const result = await tool.execute({ studentId: 'u1' }, context as never);

    expect((result.data as any).makeupsThisMonth).toBe(0);
  });
});
