import { WhatsAppWebhookService } from './whatsapp-webhook.service';

describe('WhatsAppWebhookService (WAHA)', () => {
  const prisma = {
    whatsAppConfig: { findMany: jest.fn(), findFirst: jest.fn() },
    message: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
      s === 'WORKING' ? 'connected' : 'scan_qr',
    ),
    phoneFromMeId: jest.fn((id: string | null) =>
      id ? id.replace(/@c\.us$/, '') : null,
    ),
    fetchQrDataUrl: jest.fn(),
    getSessionMe: jest.fn().mockResolvedValue({ id: '54911@c.us' }),
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

  const service = new WhatsAppWebhookService(
    prisma as never,
    redis as never,
    config as never,
    providers as never,
    waha as never,
    agent as never,
    realtime as never,
    wahaSync as never,
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
});
