import { PackBalanceService } from './pack-balance.service';

describe('PackBalanceService', () => {
  const prisma: any = {
    user: { findFirst: jest.fn() },
    service: { findFirst: jest.fn() },
    servicePass: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    classCreditMovement: { create: jest.fn() },
    payment: { create: jest.fn() },
    appointment: { findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const service = new PackBalanceService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('Escenario 1: primer pack compra 4 -> saldo 4', async () => {
    prisma.service.findFirst.mockResolvedValue({ id: 's1', sessionCount: 4, name: 'Pack 4' });
    prisma.servicePass.create.mockResolvedValue({ id: 'p1', sessionsPaid: 4, sessionsUsed: 0 });
    prisma.classCreditMovement.create.mockResolvedValue({});
    prisma.payment.create.mockResolvedValue({});

    await service.purchasePack({ businessId: 'b1', userId: 'u1', serviceId: 's1' });

    expect(prisma.servicePass.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionsPaid: 4, sessionsUsed: 0, status: 'ACTIVE' }) }),
    );

    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Juan' });
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p1', service: { name: 'Pack 4' }, sessionsPaid: 4, sessionsUsed: 0, status: 'ACTIVE', serviceId: 's1', expiresAt: null, createdAt: new Date('2025-08-01') },
    ]);
    const balance = await service.getBalance('b1', 'u1');
    expect(balance.availableClasses).toBe(4);
    expect(balance.activePacks).toHaveLength(1);
  });

  it('Escenario 2: consumo completo 4 clases -> COMPLETED', async () => {
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p1', sessionsPaid: 4, sessionsUsed: 3, status: 'ACTIVE', createdAt: new Date('2025-08-01'), expiresAt: null },
    ]);
    prisma.servicePass.updateMany.mockResolvedValue({ count: 1 });
    prisma.servicePass.findUniqueOrThrow.mockResolvedValue({ id: 'p1', sessionsPaid: 4, sessionsUsed: 4, status: 'ACTIVE' });
    prisma.servicePass.update.mockResolvedValue({});
    prisma.appointment.findFirst.mockResolvedValue({ id: 'a1', businessId: 'b1', userId: 'u1', status: 'completed', servicePassId: null, startsAt: new Date() });
    prisma.appointment.update.mockResolvedValue({});

    await service.consumeCredit({ businessId: 'b1', userId: 'u1', appointmentId: 'a1' });

    expect(prisma.servicePass.updateMany).toHaveBeenCalled();
    expect(prisma.classCreditMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CONSUMPTION', amount: -1 }) }),
    );
  });

  it('Escenario 3: renovación compra 4 consume 3 -> saldo 1', async () => {
    prisma.service.findFirst.mockResolvedValue({ id: 's1', sessionCount: 4, name: 'Pack 4' });
    prisma.servicePass.create.mockResolvedValue({ id: 'p2', sessionsPaid: 4, sessionsUsed: 0 });
    prisma.classCreditMovement.create.mockResolvedValue({});
    prisma.payment.create.mockResolvedValue({});
    await service.purchasePack({ businessId: 'b1', userId: 'u1', serviceId: 's1' });

    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Juan' });
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p1', service: { name: 'Pack 4' }, sessionsPaid: 4, sessionsUsed: 4, status: 'COMPLETED', serviceId: 's1', expiresAt: null, createdAt: new Date('2025-08-01') },
      { id: 'p2', service: { name: 'Pack 4' }, sessionsPaid: 4, sessionsUsed: 3, status: 'ACTIVE', serviceId: 's1', expiresAt: null, createdAt: new Date('2025-08-20') },
    ]);
    const balance = await service.getBalance('b1', 'u1');
    expect(balance.availableClasses).toBe(1);
    expect(balance.activePacks[0].id).toBe('p2');
  });

  it('Escenario 4: múltiples packs consume el más antiguo', async () => {
    prisma.appointment.findFirst.mockResolvedValue({ id: 'a1', businessId: 'b1', userId: 'u1', status: 'completed', servicePassId: null, startsAt: new Date() });
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p-old', sessionsPaid: 4, sessionsUsed: 0, status: 'ACTIVE', createdAt: new Date('2025-08-01'), expiresAt: null },
      { id: 'p-new', sessionsPaid: 4, sessionsUsed: 0, status: 'ACTIVE', createdAt: new Date('2025-08-20'), expiresAt: null },
    ]);
    prisma.servicePass.updateMany.mockImplementation(async ({ where }: any) => {
      expect(where.id).toBe('p-old');
      return { count: 1 };
    });
    prisma.servicePass.findUniqueOrThrow.mockResolvedValue({ id: 'p-old', sessionsPaid: 4, sessionsUsed: 1, status: 'ACTIVE' });
    prisma.appointment.update.mockResolvedValue({});
    prisma.classCreditMovement.create.mockResolvedValue({});

    await service.consumeCredit({ businessId: 'b1', userId: 'u1', appointmentId: 'a1' });
    expect(prisma.servicePass.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'p-old' }) }));
  });

  it('Escenario 5: sin saldo bloquea', async () => {
    prisma.appointment.findFirst.mockResolvedValue({ id: 'a1', businessId: 'b1', userId: 'u1', status: 'completed', servicePassId: null, startsAt: new Date() });
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p1', sessionsPaid: 4, sessionsUsed: 4, status: 'COMPLETED', createdAt: new Date(), expiresAt: null },
    ]);
    await expect(service.consumeCredit({ businessId: 'b1', userId: 'u1', appointmentId: 'a1' })).rejects.toThrow(/sin clases disponibles/i);
  });

  it('Escenario 6: concurrencia solo uno consume última clase', async () => {
    prisma.appointment.findFirst.mockResolvedValue({ id: 'a1', businessId: 'b1', userId: 'u1', status: 'completed', servicePassId: null, startsAt: new Date() });
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p1', sessionsPaid: 1, sessionsUsed: 0, status: 'ACTIVE', createdAt: new Date(), expiresAt: null },
    ]);
    prisma.servicePass.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.servicePass.findUniqueOrThrow.mockResolvedValue({ id: 'p1', sessionsPaid: 1, sessionsUsed: 1, status: 'ACTIVE' });
    prisma.appointment.update.mockResolvedValue({});
    prisma.classCreditMovement.create.mockResolvedValue({});

    await service.consumeCredit({ businessId: 'b1', userId: 'u1', appointmentId: 'a1' });
    prisma.appointment.findFirst.mockResolvedValue({ id: 'a2', businessId: 'b1', userId: 'u1', status: 'completed', servicePassId: null, startsAt: new Date() });
    prisma.servicePass.findMany.mockResolvedValue([
      { id: 'p1', sessionsPaid: 1, sessionsUsed: 0, status: 'ACTIVE', createdAt: new Date(), expiresAt: null },
    ]);
    await expect(service.consumeCredit({ businessId: 'b1', userId: 'u1', appointmentId: 'a2' })).rejects.toThrow();
  });
});
