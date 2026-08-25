import { StudentContextService } from './student-context.service';

describe('StudentContextService', () => {
  const prisma: any = {
    user: { findFirst: jest.fn() },
    appointment: { count: jest.fn(), findFirst: jest.fn() },
    servicePass: { findMany: jest.fn() },
    conversation: { findFirst: jest.fn() },
  };
  const packs: any = {
    getBalance: jest.fn(),
  };
  const service = new StudentContextService(prisma, packs);

  beforeEach(() => jest.clearAllMocks());

  it('PROSPECT: persona nueva no existe', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const ctx = await service.resolveStudentContext({ businessId: 'b1', phone: '5491199999999' });
    expect(ctx.relationshipStatus).toBe('PROSPECT');
    expect(ctx.found).toBe(false);
    expect(ctx.hasTrialAlreadyUsed).toBe(false);
  });

  it('ACTIVE_STUDENT: con clases disponibles', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Juan', phone: '5491130000001', hasUsedTrial: false });
    packs.getBalance.mockResolvedValue({ availableClasses: 2, activePacks: [{ id: 'p1' }], allPacks: [{ id: 'p1', status: 'ACTIVE' }] });
    prisma.appointment.count.mockResolvedValue(0);
    const ctx = await service.resolveStudentContext({ businessId: 'b1', phone: '5491130000001' });
    expect(ctx.relationshipStatus).toBe('ACTIVE_STUDENT');
    expect(ctx.availableClasses).toBe(2);
  });

  it('STUDENT_WITHOUT_CREDITS: sin clases pero con pack', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Juan', phone: '5491130000001', hasUsedTrial: false });
    packs.getBalance.mockResolvedValue({ availableClasses: 0, activePacks: [], allPacks: [{ id: 'p1', status: 'ACTIVE' }] });
    prisma.appointment.count.mockResolvedValue(0);
    const ctx = await service.resolveStudentContext({ businessId: 'b1', phone: '5491130000001' });
    expect(ctx.relationshipStatus).toBe('STUDENT_WITHOUT_CREDITS');
  });

  it('INACTIVE_STUDENT: sin packs', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Maria', phone: '5491130000001', hasUsedTrial: true });
    packs.getBalance.mockResolvedValue({ availableClasses: 0, activePacks: [], allPacks: [] });
    prisma.appointment.count.mockResolvedValue(1);
    const ctx = await service.resolveStudentContext({ businessId: 'b1', phone: '5491130000001' });
    expect(ctx.relationshipStatus).toBe('INACTIVE_STUDENT');
    expect(ctx.hasTrialAlreadyUsed).toBe(true);
  });

  it('hasTrialAlreadyUsed por appointment isTrial', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Juan', phone: '5491130000001', hasUsedTrial: false });
    packs.getBalance.mockResolvedValue({ availableClasses: 0, activePacks: [], allPacks: [] });
    prisma.appointment.count.mockResolvedValue(1); // has trial appointment
    const ctx = await service.resolveStudentContext({ businessId: 'b1', phone: '5491130000001' });
    expect(ctx.hasTrialAlreadyUsed).toBe(true);
  });
});
