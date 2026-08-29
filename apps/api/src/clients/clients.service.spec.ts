import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  const prisma = {
    clientStatus: { findMany: jest.fn(), findUnique: jest.fn() },
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agentConfig: { findFirst: jest.fn() },
    whatsAppConfig: { findUnique: jest.fn() },
    appointment: { findMany: jest.fn() },
    servicePass: { findMany: jest.fn() },
  };
  const businesses = { getCurrentId: jest.fn().mockResolvedValue('biz-1') };
  const service = new ClientsService(prisma as never, businesses as never);

  const activo = { id: 'status-activo', slug: 'activo', name: 'Activo' };
  const visita = { id: 'status-visita', slug: 'visita', name: 'Visita' };

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
  });

  it('lists clients filtered by status slug', async () => {
    prisma.clientStatus.findUnique.mockResolvedValue(activo);
    prisma.user.findMany.mockResolvedValue([]);

    await service.list('activo');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', statusId: 'status-activo' },
      }),
    );
  });

  it('lists clients filtered by name', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.list(undefined, '  Miguel  ');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: 'biz-1',
          OR: [
            { name: { contains: 'Miguel', mode: 'insensitive' } },
            { phone: { contains: 'Miguel' } },
            { email: { contains: 'Miguel', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('skips appointment history in lite picker mode', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        name: 'Ana',
        email: null,
        phone: '11',
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: activo,
        _count: { appointments: 2, conversations: 0 },
      },
    ]);
    prisma.servicePass.findMany.mockResolvedValue([]);

    await service.list(undefined, undefined, { lite: true });

    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(prisma.servicePass.findMany).toHaveBeenCalled();
  });

  it('creates a manual client as visita by default', async () => {
    prisma.clientStatus.findUnique.mockResolvedValue(visita);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      name: 'Carla',
      email: null,
      phone: '1144',
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: visita,
      _count: { appointments: 0, conversations: 0 },
    });

    const created = await service.create({ name: 'Carla', phone: '1144' });

    expect(created.status.slug).toBe('visita');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          name: 'Carla',
          statusId: 'status-visita',
        }),
      }),
    );
  });

  it('rejects a client without contact data', async () => {
    await expect(service.create({ notes: 'Hola' })).rejects.toThrow(
      'Hace falta al menos nombre, teléfono o email.',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('updates the status of an existing client', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Carla',
      email: null,
      phone: '1144',
    });
    prisma.clientStatus.findUnique.mockResolvedValue(activo);
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      name: 'Carla',
      email: null,
      phone: '1144',
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: activo,
      _count: { appointments: 1, conversations: 0 },
    });

    const updated = await service.update('user-1', { statusSlug: 'activo' });

    expect(updated.status.slug).toBe('activo');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statusId: 'status-activo' }),
      }),
    );
  });

  it('deletes a client of the current business', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    prisma.user.delete.mockResolvedValue({ id: 'user-1' });

    await expect(service.remove('user-1')).resolves.toEqual({ id: 'user-1' });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('opens an existing WhatsApp conversation', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'connected',
      sessionStatus: 'WORKING',
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Miguel',
      phone: '11 6371-7386',
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      hiddenAt: null,
      status: 'AI',
      userId: 'user-1',
      contactPhone: '1163717386',
      contactName: 'Miguel',
    });

    await expect(service.openWhatsApp('user-1')).resolves.toEqual({
      conversationId: 'conv-1',
    });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('creates a WhatsApp conversation when the client has none', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'connected',
      sessionStatus: 'WORKING',
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Carla',
      phone: '1144556677',
    });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.agentConfig.findFirst.mockResolvedValue({ id: 'agent-1' });
    prisma.conversation.create.mockResolvedValue({ id: 'conv-new' });

    await expect(service.openWhatsApp('user-1')).resolves.toEqual({
      conversationId: 'conv-new',
    });
    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          userId: 'user-1',
          channel: 'WHATSAPP',
          status: 'HUMAN',
          externalId: '1144556677@c.us',
          contactPhone: '1144556677',
        }),
      }),
    );
  });

  it('unhides a closed WhatsApp conversation', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'connected',
      sessionStatus: 'WORKING',
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Carla',
      phone: '1144556677',
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      hiddenAt: new Date(),
      status: 'CLOSED',
      userId: null,
      contactPhone: '1144556677',
      contactName: null,
    });

    await expect(service.openWhatsApp('user-1')).resolves.toEqual({
      conversationId: 'conv-1',
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          hiddenAt: null,
          status: 'HUMAN',
          userId: 'user-1',
        }),
      }),
    );
  });

  it('rejects WhatsApp open without a phone', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Carla',
      phone: null,
    });
    await expect(service.openWhatsApp('user-1')).rejects.toThrow(
      'Este cliente no tiene un teléfono de WhatsApp.',
    );
  });

  it('opens WhatsApp Web when the integration is disconnected', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'error',
      sessionStatus: 'FAILED',
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Miguel',
      phone: '11 6371-7386',
    });

    await expect(service.openWhatsApp('user-1')).resolves.toEqual({
      webUrl: 'https://wa.me/1163717386',
    });
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
});
