import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    service: { findFirst: jest.fn() },
    payment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
    servicePass: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) => fn(prisma)),
  };
  const businesses = { getCurrentId: jest.fn().mockResolvedValue('biz-1') };
  const service = new PaymentsService(prisma as never, businesses as never);

  const client = {
    id: 'user-1',
    name: 'Miguel',
    phone: '1163717386',
    email: null,
  };
  const packService = {
    id: 'svc-pack',
    name: 'Pack 8 clases',
    sessionCount: 8,
    price: { toString: () => '40000' },
    businessId: 'biz-1',
  };

  function paymentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pay-1',
      amount: { toString: () => '15000.5' },
      paidAt: new Date('2026-08-23T12:00:00.000Z'),
      notes: 'Seña',
      sessionsGranted: 0,
      sessionsConsumed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: client,
      service: null,
      pass: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
      fn(prisma),
    );
  });

  it('lists payments of the current business', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    await service.list();
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
      }),
    );
  });

  it('filters payments by client', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    await service.list({ userId: 'user-1' });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', userId: 'user-1' },
      }),
    );
  });

  it('filters payments by date range', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    await service.list({ from: '2026-08-01', to: '2026-08-23' });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: 'biz-1',
          paidAt: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lte: new Date('2026-08-23T23:59:59.999Z'),
          },
        },
      }),
    );
  });

  it('rejects an inverted date range', async () => {
    await expect(
      service.list({ from: '2026-08-23', to: '2026-08-01' }),
    ).rejects.toThrow('La fecha de inicio no puede ser posterior a la de fin.');
  });

  it('creates a payment for a client', async () => {
    prisma.user.findFirst.mockResolvedValue(client);
    prisma.payment.create.mockResolvedValue(paymentRow());

    const created = await service.create({
      userId: 'user-1',
      amount: 15000.5,
      paidAt: '2026-08-23',
      notes: 'Seña',
    });

    expect(created.amount).toBe(15000.5);
    expect(created.paidAt).toBe('2026-08-23');
    expect(prisma.payment.create).toHaveBeenCalled();
  });

  it('credits a full pack on a new pass', async () => {
    prisma.user.findFirst.mockResolvedValue(client);
    prisma.service.findFirst.mockResolvedValue(packService);
    prisma.servicePass.findMany.mockResolvedValue([]);
    prisma.servicePass.create.mockResolvedValue({
      id: 'pass-1',
      sessionCount: 8,
      sessionsPaid: 0,
      sessionsUsed: 0,
    });
    prisma.servicePass.update.mockResolvedValue({
      id: 'pass-1',
      sessionCount: 8,
      sessionsPaid: 8,
      sessionsUsed: 0,
    });
    prisma.payment.create.mockResolvedValue(
      paymentRow({
        amount: { toString: () => '40000' },
        notes: null,
        sessionsGranted: 8,
        sessionsConsumed: 0,
        service: packService,
        pass: {
          id: 'pass-1',
          sessionCount: 8,
          sessionsPaid: 8,
          sessionsUsed: 0,
        },
      }),
    );

    const created = await service.create({
      userId: 'user-1',
      amount: 40000,
      paidAt: '2026-08-23',
      serviceId: 'svc-pack',
      cover: 'pack',
    });

    expect(created.sessionsGranted).toBe(8);
    expect(created.pass?.sessionsPaid).toBe(8);
    expect(created.pass?.sessionsUsed).toBe(0);
    expect(created.pass?.remaining).toBe(0);
    expect(created.pass?.unusedCredits).toBe(8);
    expect(prisma.servicePass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sessionsPaid: 8, sessionsUsed: 0 },
      }),
    );
  });

  it('pays class by class on the same open pass', async () => {
    prisma.user.findFirst.mockResolvedValue(client);
    prisma.service.findFirst.mockResolvedValue(packService);
    prisma.servicePass.findMany.mockResolvedValue([
      {
        id: 'pass-1',
        sessionCount: 8,
        sessionsPaid: 1,
        sessionsUsed: 1,
      },
    ]);
    prisma.servicePass.update.mockResolvedValue({
      id: 'pass-1',
      sessionCount: 8,
      sessionsPaid: 2,
      sessionsUsed: 2,
    });
    prisma.payment.create.mockResolvedValue(
      paymentRow({
        amount: { toString: () => '5000' },
        notes: null,
        sessionsGranted: 1,
        sessionsConsumed: 1,
        service: packService,
        pass: {
          id: 'pass-1',
          sessionCount: 8,
          sessionsPaid: 2,
          sessionsUsed: 2,
        },
      }),
    );

    const created = await service.create({
      userId: 'user-1',
      amount: 5000,
      paidAt: '2026-08-23',
      serviceId: 'svc-pack',
      cover: 'session',
    });

    expect(created.sessionsGranted).toBe(1);
    expect(created.pass?.sessionsPaid).toBe(2);
    expect(created.pass?.remaining).toBe(6);
    expect(created.pass?.unusedCredits).toBe(0);
    expect(prisma.servicePass.create).not.toHaveBeenCalled();
    expect(prisma.servicePass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sessionsPaid: 2, sessionsUsed: 2 },
      }),
    );
  });

  it('uses one class from a prepaid pack', async () => {
    prisma.servicePass.findFirst.mockResolvedValue({
      id: 'pass-1',
      businessId: 'biz-1',
      sessionCount: 8,
      sessionsPaid: 8,
      sessionsUsed: 3,
    });
    prisma.servicePass.update.mockResolvedValue({
      id: 'pass-1',
      sessionCount: 8,
      sessionsPaid: 8,
      sessionsUsed: 4,
      service: { id: 'svc-pack', name: 'Pack 8 clases', sessionCount: 8 },
    });

    const used = await service.useSession('pass-1');
    expect(used.sessionsUsed).toBe(4);
    expect(used.remaining).toBe(0);
    expect(used.unusedCredits).toBe(4);
  });

  it('does not use more classes than paid', async () => {
    prisma.servicePass.findFirst.mockResolvedValue({
      id: 'pass-1',
      businessId: 'biz-1',
      sessionCount: 8,
      sessionsPaid: 2,
      sessionsUsed: 2,
    });
    await expect(service.useSession('pass-1')).rejects.toThrow(
      'No quedan clases en este pack.',
    );
  });

  it('reverts pack credits when deleting a payment', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      businessId: 'biz-1',
      passId: 'pass-1',
      sessionsGranted: 1,
      sessionsConsumed: 1,
    });
    prisma.servicePass.findFirst.mockResolvedValue({
      id: 'pass-1',
      sessionsPaid: 2,
      sessionsUsed: 2,
    });
    prisma.servicePass.update.mockResolvedValue({});
    prisma.payment.delete.mockResolvedValue({});

    await service.remove('pay-1');
    expect(prisma.servicePass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sessionsPaid: 1, sessionsUsed: 1 },
      }),
    );
    expect(prisma.payment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
  });

  it('rejects a payment without a valid client', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.create({
        userId: 'missing',
        amount: 100,
        paidAt: '2026-08-23',
      }),
    ).rejects.toThrow('Cliente no encontrado');
  });

  it('rejects a non-positive amount', async () => {
    prisma.user.findFirst.mockResolvedValue(client);
    await expect(
      service.create({
        userId: 'user-1',
        amount: 0,
        paidAt: '2026-08-23',
      }),
    ).rejects.toThrow('El importe tiene que ser mayor a 0.');
  });
});
