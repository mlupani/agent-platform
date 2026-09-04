import { WhatsAppWebhookService } from './whatsapp-webhook.service';

describe('WhatsAppWebhookService (WAHA)', () => {
  const prisma = {
    whatsAppConfig: { findMany: jest.fn(), findFirst: jest.fn() },
    business: { findUnique: jest.fn() },
    message: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    agentConfig: { findFirst: jest.fn() },
  };
  const redis = { acquireLock: jest.fn() };
  const config = {
    findBySessionName: jest.fn(),
    setStatus: jest.fn(),
    getForRuntime: jest.fn().mockResolvedValue({ meId: '54911@c.us' }),
  };
  const providers = {
    getForBusiness: jest.fn(),
  };
  const waha = {
    mapSessionStatus: jest.fn((s: string) =>
      s === 'WORKING' ? 'connected' : s === 'STOPPED' ? 'disconnected' : 'scan_qr',
    ),
    phoneFromMeId: jest.fn((id: string | null) =>
      id ? id.replace(/@c\.us$/, '') : null,
    ),
    fetchQrDataUrl: jest.fn(),
    getSessionMe: jest.fn().mockResolvedValue({ id: '54911@c.us' }),
    downloadMedia: jest.fn(),
  };
  const agent = { run: jest.fn() };
  const realtime = {
    whatsappStatusChanged: jest.fn(),
    whatsappQrUpdated: jest.fn(),
    conversationMessageCreated: jest.fn(),
    conversationUpdated: jest.fn(),
    conversationBotStatusChanged: jest.fn(),
    messageStatusUpdated: jest.fn(),
  };

  const wahaSync = {
    purgeChats: jest.fn().mockResolvedValue(0),
    syncChats: jest.fn().mockResolvedValue(0),
  };
  const transcription = {
    transcribe: jest.fn(),
  };
  const leads = {
    capture: jest.fn().mockResolvedValue({ id: 'lead-1' }),
  };

  const service = new WhatsAppWebhookService(
    prisma as never,
    redis as never,
    config as never,
    providers as never,
    waha as never,
    agent as never,
    realtime as never,
    wahaSync as never,
    transcription as never,
    leads as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles session.status and emits realtime', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });
    waha.fetchQrDataUrl.mockResolvedValue('data:image/png;base64,abc');

    const result = await service.handleWahaEvent({
      event: 'session.status',
      session: 'default',
      me: { id: '54911@c.us' },
      payload: { status: 'SCAN_QR_CODE' },
    });

    expect(result).toEqual({ processed: 1 });
    expect(config.setStatus).toHaveBeenCalledWith(
      'biz-1',
      'scan_qr',
      null,
      expect.objectContaining({
        sessionStatus: 'SCAN_QR_CODE',
        meId: '54911@c.us',
      }),
    );
    expect(realtime.whatsappStatusChanged).toHaveBeenCalled();
    expect(realtime.whatsappQrUpdated).toHaveBeenCalled();
    expect(wahaSync.purgeChats).not.toHaveBeenCalled();
  });

  it('borra chats de WhatsApp cuando la sesión queda STOPPED', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });
    waha.mapSessionStatus.mockReturnValue('disconnected');

    const result = await service.handleWahaEvent({
      event: 'session.status',
      session: 'default',
      payload: { status: 'STOPPED' },
    });

    expect(result).toEqual({ processed: 1 });
    expect(wahaSync.purgeChats).toHaveBeenCalledWith('biz-1');
  });

  it('dedups inbound message by redis lock', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });
    redis.acquireLock.mockResolvedValue(false);

    const result = await service.handleWahaEvent({
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_54911@c.us_ABCDEF',
        from: '54911@c.us',
        fromMe: false,
        body: 'hola',
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({ processed: 0 });
    expect(agent.run).not.toHaveBeenCalled();
  });

  it('ignores WhatsApp status/stories broadcasts', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });

    const result = await service.handleWahaEvent({
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_status@broadcast_ABCDEF',
        from: 'status@broadcast',
        fromMe: false,
        body: 'Miren mi estado',
        timestamp: Date.now(),
        isStatus: true,
      },
    });

    expect(result).toEqual({ processed: 0 });
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(agent.run).not.toHaveBeenCalled();
  });

  it('ignores fromMe status stories', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });

    const result = await service.handleWahaEvent({
      event: 'message.any',
      session: 'default',
      payload: {
        id: 'true_status@broadcast_ABCDEF',
        from: 'status@broadcast',
        to: 'status@broadcast',
        fromMe: true,
        body: 'Mi estado',
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({ processed: 0 });
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(agent.run).not.toHaveBeenCalled();
  });

  it('transcribe notas de voz vacías y corre el agente', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });
    redis.acquireLock.mockResolvedValue(true);
    prisma.business.findUnique.mockResolvedValue({ language: 'es' });
    waha.downloadMedia.mockResolvedValue({
      buffer: Buffer.from('ogg'),
      mimeType: 'audio/ogg',
      filename: 'voice.ogg',
    });
    transcription.transcribe.mockResolvedValue('Quiero un turno mañana');
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1', name: 'Ana' });
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        status: 'AI',
        hiddenAt: null,
        metadata: {},
        externalId: '5491112345678@c.us',
        contactPhone: '5491112345678',
        contactName: 'Ana',
      },
    ]);
    prisma.conversation.update.mockResolvedValue({
      id: 'conv-1',
      status: 'AI',
      hiddenAt: null,
      metadata: {},
      externalId: '5491112345678@c.us',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      unreadCount: 1,
      lastMessageAt: new Date(),
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    agent.run.mockResolvedValue({ status: 'AI', message: '¿A qué hora?' });
    providers.getForBusiness.mockResolvedValue({
      sendText: jest.fn().mockResolvedValue({ externalId: 'out-1' }),
    });

    const result = await service.handleWahaEvent({
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_5491112345678@c.us_VOICE1',
        from: '5491112345678@c.us',
        fromMe: false,
        body: '',
        type: 'ptt',
        hasMedia: true,
        media: {
          url: 'http://localhost:3000/api/files/voice.ogg',
          mimetype: 'audio/ogg; codecs=opus',
        },
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({ processed: 1 });
    expect(waha.downloadMedia).toHaveBeenCalled();
    expect(transcription.transcribe).toHaveBeenCalled();
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        channel: 'WHATSAPP',
        message: '[Audio] Quiero un turno mañana',
      }),
    );
  });

  it('parsea una tarjeta de contacto compartida en vez de tratarla como adjunto', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });
    redis.acquireLock.mockResolvedValue(true);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        status: 'AI',
        hiddenAt: null,
        metadata: {},
        externalId: '5491164369670@c.us',
        contactPhone: '5491164369670',
        contactName: null,
      },
    ]);
    prisma.conversation.update.mockResolvedValue({
      id: 'conv-1',
      status: 'AI',
      hiddenAt: null,
      metadata: {},
      externalId: '5491164369670@c.us',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      unreadCount: 1,
      lastMessageAt: new Date(),
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    agent.run.mockResolvedValue({ status: 'AI', message: 'Gracias Julieta' });
    providers.getForBusiness.mockResolvedValue({
      sendText: jest.fn().mockResolvedValue({ externalId: 'out-1' }),
    });

    const result = await service.handleWahaEvent({
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_5491164369670@c.us_VCARD1',
        from: '5491164369670@c.us',
        fromMe: false,
        body: '',
        type: 'vcard',
        vCards: [
          [
            'BEGIN:VCARD',
            'VERSION:3.0',
            'FN:Julieta Lujan Da Silva',
            'TEL;type=CELL;waid=5491164369670:+54 9 11 6436-9670',
            'END:VCARD',
          ].join('\n'),
        ],
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({ processed: 1 });
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        channel: 'WHATSAPP',
        message: '[Contacto] Julieta Lujan Da Silva · +54 9 11 6436-9670',
      }),
    );
  });

  it('reabrir un chat oculto que estaba en WAITING_HUMAN no reactiva el bot', async () => {
    config.findBySessionName.mockResolvedValue({
      businessId: 'biz-1',
      sessionName: 'default',
      enabled: true,
    });
    redis.acquireLock.mockResolvedValue(true);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        status: 'WAITING_HUMAN',
        hiddenAt: new Date('2026-09-03T10:00:00.000Z'),
        metadata: {},
        externalId: '5491164369670@c.us',
        contactPhone: '5491164369670',
        contactName: null,
      },
    ]);
    prisma.conversation.update.mockImplementation(async ({ data }: any) => ({
      id: 'conv-1',
      status: data.status ?? 'WAITING_HUMAN',
      hiddenAt: null,
      metadata: {},
      externalId: '5491164369670@c.us',
    }));
    prisma.conversation.findUnique.mockResolvedValue({
      unreadCount: 1,
      lastMessageAt: new Date(),
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
    agent.run.mockResolvedValue({
      status: 'WAITING_HUMAN',
      message: 'Esta conversación está siendo atendida por una persona.',
    });

    const result = await service.handleWahaEvent({
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_5491164369670@c.us_REOPEN1',
        from: '5491164369670@c.us',
        fromMe: false,
        body: 'Hola? siguen ahí?',
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({ processed: 1 });
    const reopenCall = prisma.conversation.update.mock.calls.find(
      (c: [{ data?: { hiddenAt?: unknown } }]) => c[0]?.data?.hiddenAt === null,
    );
    expect(reopenCall?.[0].data.status).toBeUndefined();
  });
});
