import {
  SocialInboxService,
  parseInboxEvent,
} from './social-inbox.service';

describe('parseInboxEvent', () => {
  it('parsea message.received de Instagram', () => {
    const inbound = parseInboxEvent({
      event: 'message.received',
      message: {
        id: 'msg_1',
        conversationId: 'conv_1',
        direction: 'incoming',
        text: 'Hola',
        sender: { id: 'ig_user', name: 'Jane', username: 'jane_doe' },
      },
      account: {
        accountId: 'acc_ig',
        platform: 'instagram',
      },
    });
    expect(inbound).toEqual(
      expect.objectContaining({
        accountId: 'acc_ig',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        text: 'Hola',
        fromMe: false,
        participantId: 'ig_user',
        participantUsername: 'jane_doe',
      }),
    );
  });

  it('ignora DMs que no son de Instagram', () => {
    expect(
      parseInboxEvent({
        event: 'message.received',
        message: { id: 'm', conversationId: 'c', text: 'hi' },
        account: { accountId: 'acc_tt', platform: 'tiktok' },
      }),
    ).toBeNull();
  });

  it('usa placeholder si hay adjunto sin texto', () => {
    const inbound = parseInboxEvent({
      event: 'message.received',
      message: {
        id: 'msg_att',
        conversationId: 'conv_1',
        attachments: [{ type: 'image' }],
        sender: { id: 'ig_user' },
      },
      account: { accountId: 'acc_ig', platform: 'instagram' },
    });
    expect(inbound?.text).toBe('[Adjunto]');
  });
});

describe('SocialInboxService', () => {
  const prisma = {
    socialConnection: { findUnique: jest.fn() },
    message: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const provider = {
    sendInboxMessage: jest.fn().mockResolvedValue({ externalId: 'out_1' }),
    listInboxThreads: jest.fn().mockResolvedValue([]),
    listInboxMessages: jest.fn().mockResolvedValue([]),
  };
  const factory = { get: () => provider };
  const agent = {
    run: jest.fn().mockResolvedValue({
      status: 'AI',
      message: 'Respuesta del agente',
    }),
  };
  const realtime = {
    conversationMessageCreated: jest.fn(),
    conversationUpdated: jest.fn(),
    conversationBotStatusChanged: jest.fn(),
  };

  const service = new SocialInboxService(
    prisma as never,
    redis as never,
    factory as never,
    agent as never,
    realtime as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    redis.acquireLock.mockResolvedValue(true);
    prisma.socialConnection.findUnique.mockResolvedValue({
      businessId: 'biz-a',
      platform: 'instagram',
      status: 'connected',
      externalAccountId: 'acc_ig',
      zernioProfileId: 'prof_1',
    });
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1', name: 'Jane' });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({
      id: 'local-conv',
      status: 'AI',
      hiddenAt: null,
      externalId: 'conv_1',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      unreadCount: 1,
      lastMessageAt: new Date(),
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'local-conv',
      unreadCount: 1,
    });
  });

  it('ignora accountIds que no están en la DB', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue(null);
    const applied = await service.handleMessageEvent({
      event: 'message.received',
      message: {
        id: 'msg_1',
        conversationId: 'conv_1',
        text: 'Hola',
        sender: { id: 'ig_user' },
      },
      account: { accountId: 'unknown', platform: 'instagram' },
    });
    expect(applied).toBe(false);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it('persiste un inbound y corre el agente', async () => {
    prisma.message.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'msg-local',
        sender: 'CLIENT',
        externalId: 'msg_1',
      });

    const applied = await service.handleMessageEvent({
      event: 'message.received',
      message: {
        id: 'msg_1',
        conversationId: 'conv_1',
        text: 'Quiero un turno',
        sender: { id: 'ig_user', username: 'jane_doe' },
      },
      account: { accountId: 'acc_ig', platform: 'instagram' },
    });

    expect(applied).toBe(true);
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-a',
        channel: 'INSTAGRAM',
        message: 'Quiero un turno',
      }),
    );
    expect(provider.sendInboxMessage).toHaveBeenCalledWith({
      accountId: 'acc_ig',
      conversationId: 'conv_1',
      message: 'Respuesta del agente',
    });
  });

  it('no corre el agente si el canal Instagram está en inactivo', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue({
      businessId: 'biz-a',
      platform: 'instagram',
      status: 'connected',
      externalAccountId: 'acc_ig',
      zernioProfileId: 'prof_1',
      agentEnabled: false,
    });
    prisma.message.create.mockResolvedValue({
      id: 'msg-local',
      content: 'Hola',
      sender: 'CLIENT',
      createdAt: new Date(),
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'local-conv',
      unreadCount: 1,
    });

    const applied = await service.handleMessageEvent({
      event: 'message.received',
      message: {
        id: 'msg_off',
        conversationId: 'conv_1',
        text: 'Hola',
        sender: { id: 'ig_user' },
      },
      account: { accountId: 'acc_ig', platform: 'instagram' },
    });

    expect(applied).toBe(true);
    expect(agent.run).not.toHaveBeenCalled();
    expect(provider.sendInboxMessage).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalled();
  });

  it('trae hilos de Zernio al sincronizar la bandeja', async () => {
    provider.listInboxThreads.mockResolvedValue([
      {
        id: 'conv_z',
        lastMessage: 'Hola desde IG',
        updatedAt: new Date('2026-08-21T12:00:00Z'),
        unreadCount: 9,
      },
    ]);
    prisma.conversation.create.mockResolvedValue({
      id: 'local-conv',
      status: 'AI',
      hiddenAt: null,
      externalId: 'conv_z',
    });

    const count = await service.syncChats('biz-a', { force: true });

    expect(count).toBe(1);
    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'INSTAGRAM',
          externalId: 'conv_z',
        }),
      }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastMessagePreview: 'Hola desde IG',
        }),
      }),
    );
    const unreadWrites = prisma.conversation.update.mock.calls.filter(
      (call: [{ data?: { unreadCount?: unknown } }]) =>
        call[0]?.data?.unreadCount !== undefined,
    );
    expect(unreadWrites).toHaveLength(0);
  });

  it('si el hilo de Zernio está más nuevo, trae el mensaje y emite realtime', async () => {
    const freshAt = new Date();
    provider.listInboxThreads.mockResolvedValue([
      {
        id: 'conv_z',
        lastMessage: 'Mensaje nuevo',
        updatedAt: freshAt,
      },
    ]);
    prisma.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'local-conv',
        externalId: 'conv_z',
        channel: 'INSTAGRAM',
        hiddenAt: null,
        lastMessageAt: new Date('2026-08-21T11:00:00Z'),
        lastMessagePreview: 'viejo',
      });
    prisma.conversation.create.mockResolvedValue({
      id: 'local-conv',
      status: 'AI',
      hiddenAt: null,
      externalId: 'conv_z',
      lastMessageAt: new Date('2026-08-21T11:00:00Z'),
      lastMessagePreview: 'viejo',
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'local-conv',
      hiddenAt: null,
      lastMessageAt: freshAt,
      lastMessagePreview: 'Mensaje nuevo',
    });
    provider.listInboxMessages.mockResolvedValue([
      {
        id: 'm_new',
        text: 'Mensaje nuevo',
        fromMe: false,
        createdAt: freshAt,
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({
      id: 'local-msg',
      content: 'Mensaje nuevo',
      sender: 'CLIENT',
      createdAt: freshAt,
    });

    await service.syncChats('biz-a', { force: true });

    expect(provider.listInboxMessages).toHaveBeenCalledWith({
      accountId: 'acc_ig',
      conversationId: 'conv_z',
    });
    expect(prisma.message.create).toHaveBeenCalled();
    expect(realtime.conversationMessageCreated).toHaveBeenCalledWith(
      'biz-a',
      expect.objectContaining({
        conversationId: 'local-conv',
        message: expect.objectContaining({ id: 'local-msg' }),
      }),
    );
  });

  it('marca el inbox live cuando llega un webhook de Instagram', async () => {
    prisma.message.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'msg-local',
        sender: 'CLIENT',
        externalId: 'msg_1',
      });

    await service.handleMessageEvent({
      event: 'message.received',
      message: {
        id: 'msg_1',
        conversationId: 'conv_1',
        text: 'Hola',
        sender: { id: 'ig_user' },
      },
      account: { accountId: 'acc_ig', platform: 'instagram' },
    });

    expect(redis.set).toHaveBeenCalledWith(
      'zernio:inbox:live:biz-a',
      expect.any(String),
      15 * 60,
    );
  });

  it('inboxSyncMode es poll si no hubo webhook reciente', async () => {
    redis.get.mockResolvedValue(null);
    await expect(service.inboxSyncMode('biz-a')).resolves.toBe('poll');
    redis.get.mockResolvedValue('1');
    await expect(service.inboxSyncMode('biz-a')).resolves.toBe('webhook');
  });

  it('un DM nuevo por sync corre el agente sin depender de WhatsApp ni webhook', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'local-conv',
      externalId: 'conv_z',
      channel: 'INSTAGRAM',
      status: 'AI',
      hiddenAt: null,
      userId: 'user-1',
      contactName: 'Jane',
      contactUsername: 'jane',
      contactAvatarUrl: null,
      metadata: {},
    });
    provider.listInboxMessages.mockResolvedValue([
      {
        id: 'm_live',
        text: 'Hola bot',
        fromMe: false,
        createdAt: new Date(),
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({
      id: 'msg-1',
      sender: 'CLIENT',
      createdAt: new Date(),
      conversationId: 'local-conv',
    });

    await service.syncMessages('biz-a', 'local-conv', { force: true });

    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-a',
        channel: 'INSTAGRAM',
        message: 'Hola bot',
      }),
    );
    expect(provider.sendInboxMessage).toHaveBeenCalledWith({
      accountId: 'acc_ig',
      conversationId: 'conv_z',
      message: 'Respuesta del agente',
    });
  });
});
