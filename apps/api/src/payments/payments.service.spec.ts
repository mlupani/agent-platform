import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    payment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const businesses = { getCurrentId: jest.fn().mockResolvedValue('biz-1') };
  const service = new PaymentsService(prisma as never, businesses as never);

  const client = {
    id: 'user-1',
    name: 'Miguel',
    phone: '1163717386',
    email: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
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
    prisma.payment.create.mockResolvedValue({
      id: 'pay-1',
      amount: { toString: () => '15000.5' },
      paidAt: new Date('2026-08-23T12:00:00.000Z'),
      notes: 'Seña',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: client,
    });

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
