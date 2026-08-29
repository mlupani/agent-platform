import { ConversationsService } from './conversations.service';

describe('ConversationsService inbox', () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    whatsAppConfig: { findUnique: jest.fn() },
    socialConnection: { findUnique: jest.fn(), findMany: jest.fn() },
    message: {
      create: jest.fn(),
    },
  };
  const businesses = {
    getCurrentId: jest.fn().mockResolvedValue('biz-1'),
  };
  const channels = {
    get: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const realtime = {
    conversationMessageCreated: jest.fn(),
    conversationUpdated: jest.fn(),
    conversationBotStatusChanged: jest.fn(),
  };
  const wahaSync = {
    syncChats: jest.fn().mockResolvedValue(0),
    syncMessages: jest.fn().mockResolvedValue(0),
  };
  const socialInbox = {
    syncChats: jest.fn().mockResolvedValue(0),
    syncMessages: jest.fn().mockResolvedValue(0),
    isPushLive: jest.fn().mockResolvedValue(false),
    inboxSyncMode: jest.fn().mockResolvedValue('poll'),
  };
  const service = new ConversationsService(
    prisma as never,
    businesses as never,
    channels as never,
    realtime as never,
    wahaSync as never,
    socialInbox as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'connected',
      sessionStatus: 'WORKING',
    });
    prisma.socialConnection.findUnique.mockResolvedValue({
      status: 'connected',
    });
    prisma.socialConnection.findMany.mockResolvedValue([
      { platform: 'instagram', status: 'connected' },
    ]);
  });

  it('scopes get() to the current business', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.get('conv-1', { role: 'ADMIN' })).rejects.toThrow(
      'Conversation not found',
    );
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'conv-1',
          businessId: 'biz-1',
          hiddenAt: null,
          channel: { in: ['WEB', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'PLAYGROUND'] },
        }),
      }),
    );
  });

  it('abre un chat de WhatsApp aunque la integración esté caída', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'error',
      sessionStatus: 'FAILED',
    });
    const conversation = {
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'WHATSAPP',
      status: 'HUMAN',
      hiddenAt: null,
      user: null,
      messages: [],
      business: { id: 'biz-1', name: 'Lumina' },
    };
    prisma.conversation.findFirst.mockResolvedValue(conversation);

    const result = await service.get('conv-1', { role: 'ADMIN' });
    expect(result.id).toBe('conv-1');
    expect(prisma.whatsAppConfig.findUnique).not.toHaveBeenCalled();
  });

  it('hides playground channels from USER role list', async () => {
    prisma.conversation.findMany.mockResolvedValue([]);
    await service.list(undefined, { role: 'USER' });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: { in: ['WEB', 'WHATSAPP', 'INSTAGRAM'] },
        }),
      }),
    );
  });

  it('oculta WhatsApp si la integración está desconectada', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'disconnected',
      sessionStatus: 'STOPPED',
    });
    prisma.conversation.findMany.mockResolvedValue([]);
    await service.list(undefined, { role: 'ADMIN' });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: { in: ['WEB', 'PLAYGROUND', 'INSTAGRAM'] },
        }),
      }),
    );
  });

  it('pauses bot by setting HUMAN status', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      status: 'AI',
      metadata: {},
      channel: 'WHATSAPP',
      hiddenAt: null,
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'conv-1',
      status: 'HUMAN',
    });

    const result = await service.pause('conv-1', { role: 'ADMIN' });
    expect(result.status).toBe('HUMAN');
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'HUMAN' }),
      }),
    );
  });

  it('hides a conversation from the inbox without closing it', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      status: 'AI',
      channel: 'WEB',
      hiddenAt: null,
      metadata: {},
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'conv-1',
      status: 'AI',
    });

    const result = await service.hide('conv-1', { role: 'ADMIN' });
    expect(result).toEqual({ ok: true, id: 'conv-1' });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hiddenAt: expect.any(Date),
          unreadCount: 0,
        }),
      }),
    );
    const updateData = prisma.conversation.update.mock.calls[0][0].data;
    expect(updateData.status).toBeUndefined();
  });

  it('sends a human message and marks bot as HUMAN', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      status: 'AI',
      channel: 'WHATSAPP',
      hiddenAt: null,
    });
    prisma.message.create.mockResolvedValue({
      id: 'msg-1',
      sender: 'HUMAN',
      content: 'Hola, te atiende',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
    });
    prisma.conversation.update.mockResolvedValue({});

    const message = await service.sendHumanMessage(
      'conv-1',
      'Hola, te atiende',
      { role: 'ADMIN' },
    );
    expect(message.sender).toBe('HUMAN');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sender: 'HUMAN',
          role: 'assistant',
          content: 'Hola, te atiende',
        }),
      }),
    );
    expect(channels.get).toHaveBeenCalledWith('WHATSAPP');
  });

  it('al abrir un chat de Instagram fuerza el pull de mensajes', async () => {
    socialInbox.inboxSyncMode.mockResolvedValue('poll');
    const conversation = {
      id: 'conv-ig',
      businessId: 'biz-1',
      channel: 'INSTAGRAM',
      hiddenAt: null,
      status: 'AI',
      messages: [],
      user: { id: 'u1', name: 'Jane', phone: null, email: null },
      business: { id: 'biz-1', name: 'Novalup' },
    };
    prisma.conversation.findFirst.mockResolvedValue(conversation);

    const result = await service.get('conv-ig', { role: 'ADMIN' });

    expect(socialInbox.syncMessages).toHaveBeenCalledWith('biz-1', 'conv-ig', {
      force: true,
    });
    expect(result.inboxSync).toBe('poll');
  });

  it('en background no pulea Instagram si el webhook está vivo', async () => {
    socialInbox.isPushLive.mockResolvedValue(true);
    prisma.conversation.findMany.mockResolvedValue([]);

    await service.list(undefined, { role: 'ADMIN', pull: false });

    expect(socialInbox.syncChats).not.toHaveBeenCalled();
  });

  it('al recargar la bandeja fuerza el pull de Instagram', async () => {
    prisma.conversation.findMany.mockResolvedValue([]);

    await service.list(undefined, { role: 'ADMIN' });

    expect(socialInbox.syncChats).toHaveBeenCalledWith('biz-1', {
      force: true,
    });
  });

  it('incluye Messenger en la bandeja si Facebook está conectado', async () => {
    prisma.socialConnection.findMany.mockResolvedValue([
      { platform: 'facebook', status: 'connected' },
    ]);
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      status: 'disconnected',
      sessionStatus: 'STOPPED',
    });
    prisma.conversation.findMany.mockResolvedValue([]);
    await service.list(undefined, { role: 'USER' });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: { in: ['WEB', 'FACEBOOK'] },
        }),
      }),
    );
  });
});
