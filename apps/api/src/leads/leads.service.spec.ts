import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  const prisma = {
    lead: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const businesses = { getCurrentId: jest.fn().mockResolvedValue('biz-1') };
  const service = new LeadsService(prisma as never, businesses as never);

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
  });

  it('lists leads for the current business with conversation link', async () => {
    const createdAt = new Date('2026-08-22T12:00:00.000Z');
    prisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Ana',
        email: 'ana@test.com',
        phone: '54911',
        message: 'Quiero un turno',
        source: 'WEB',
        conversationId: 'conv-1',
        createdAt,
        conversation: {
          id: 'conv-1',
          channel: 'WEB',
          contactName: 'Ana',
          hiddenAt: null,
        },
      },
    ]);

    const rows = await service.list();

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        take: 200,
      }),
    );
    expect(rows).toEqual([
      {
        id: 'lead-1',
        name: 'Ana',
        email: 'ana@test.com',
        phone: '54911',
        message: 'Quiero un turno',
        source: 'WEB',
        channel: 'WEB',
        conversationId: 'conv-1',
        createdAt,
      },
    ]);
  });

  it('does not capture a lead without contact data', async () => {
    await expect(
      service.capture({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        message: 'Hola',
      }),
    ).resolves.toBeNull();
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('creates a lead when the conversation has none', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    prisma.lead.create.mockResolvedValue({ id: 'lead-1' });

    await expect(
      service.capture({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        name: 'Ana',
        phone: '54911',
        source: 'PLAYGROUND',
      }),
    ).resolves.toEqual({ id: 'lead-1' });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        name: 'Ana',
        phone: '54911',
        source: 'PLAYGROUND',
      }),
    });
  });

  it('updates the existing lead for the same conversation', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      name: 'Ana',
      email: null,
      phone: '54911',
      message: null,
      source: 'PLAYGROUND',
      userId: null,
      metadata: { conversationId: 'conv-1' },
    });
    prisma.lead.update.mockResolvedValue({ id: 'lead-1' });

    await expect(
      service.capture({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        name: 'Ana Pérez',
        email: 'ana@test.com',
        source: 'PLAYGROUND',
        metadata: { appointmentId: 'apt-1' },
      }),
    ).resolves.toEqual({ id: 'lead-1' });

    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        name: 'Ana Pérez',
        email: 'ana@test.com',
        phone: '54911',
      }),
    });
  });
});


describe('LeadsService', () => {
  const prisma = {
    lead: { findMany: jest.fn() },
  };
  const businesses = { getCurrentId: jest.fn().mockResolvedValue('biz-1') };
  const service = new LeadsService(prisma as never, businesses as never);

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
  });

  it('lists leads for the current business with conversation link', async () => {
    const createdAt = new Date('2026-08-22T12:00:00.000Z');
    prisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Ana',
        email: 'ana@test.com',
        phone: '54911',
        message: 'Quiero un turno',
        source: 'WEB',
        conversationId: 'conv-1',
        createdAt,
        conversation: {
          id: 'conv-1',
          channel: 'WEB',
          contactName: 'Ana',
          hiddenAt: null,
        },
      },
    ]);

    const rows = await service.list();

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        take: 200,
      }),
    );
    expect(rows).toEqual([
      {
        id: 'lead-1',
        name: 'Ana',
        email: 'ana@test.com',
        phone: '54911',
        message: 'Quiero un turno',
        source: 'WEB',
        channel: 'WEB',
        conversationId: 'conv-1',
        createdAt,
      },
    ]);
  });
});
