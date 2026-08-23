import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  const prisma = {
    lead: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
    },
  };
  const businesses = { getCurrentId: jest.fn().mockResolvedValue('biz-1') };
  const contactability = {
    resolve: jest.fn().mockResolvedValue({
      isContactable: true,
      channels: ['whatsapp'],
      missingFields: [],
    }),
  };
  const events = { append: jest.fn().mockResolvedValue(undefined) };
  const conversion = { convert: jest.fn() };
  const followUps = {
    scheduleAutoSequence: jest.fn().mockResolvedValue([]),
    cancelPendingAuto: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LeadsService(
    prisma as never,
    businesses as never,
    contactability as never,
    events as never,
    conversion as never,
    followUps as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
    contactability.resolve.mockResolvedValue({
      isContactable: true,
      channels: ['whatsapp'],
      missingFields: [],
    });
    prisma.conversation.findFirst.mockResolvedValue(null);
  });

  it('lists leads for the current business with conversation link', async () => {
    const createdAt = new Date('2026-08-22T12:00:00.000Z');
    prisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        businessId: 'biz-1',
        name: 'Ana',
        email: 'ana@test.com',
        phone: '54911',
        message: 'Quiero un turno',
        source: 'WEB',
        status: 'contacted',
        interest: 'Pilates 2x',
        isContactable: true,
        conversationId: 'conv-1',
        createdAt,
        lastContactedAt: null,
        lastInboundAt: null,
        conversation: {
          id: 'conv-1',
          channel: 'WEB',
          contactName: 'Ana',
          contactPhone: null,
          lastMessageAt: createdAt,
          hiddenAt: null,
        },
        followUps: [{ scheduledAt: new Date('2026-08-23T12:00:00.000Z') }],
      },
    ]);

    const rows = await service.list();

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        take: 200,
      }),
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: 'lead-1',
        name: 'Ana',
        email: 'ana@test.com',
        phone: '54911',
        channel: 'WEB',
        conversationId: 'conv-1',
        status: 'contacted',
        interest: 'Pilates 2x',
        isContactable: true,
        nextFollowUpAt: '2026-08-23T12:00:00.000Z',
      }),
    );
  });

  it('does not capture a lead without contact data', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);

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
        status: 'contacted',
      }),
    });
    expect(events.append).toHaveBeenCalled();
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
      status: 'contacted',
      interest: null,
      objections: null,
      preferredChannel: null,
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

  it('creates a manual lead for the current business', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    prisma.lead.create.mockResolvedValue({ id: 'lead-manual' });

    await expect(
      service.createManual({
        name: 'Luis',
        phone: '54911',
        channel: 'WHATSAPP',
        message: 'Llamó por un turno',
      }),
    ).resolves.toEqual({ id: 'lead-manual' });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        name: 'Luis',
        phone: '54911',
        source: 'WHATSAPP',
        message: 'Llamó por un turno',
      }),
    });
  });

  it('rejects a manual lead without contact data', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await expect(service.createManual({ message: 'Sin datos' })).rejects.toThrow(
      'Hace falta al menos nombre, teléfono o email.',
    );
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});
