import { CallConfigService } from './call-config.service';

describe('CallConfigService', () => {
  const prisma = {
    vapiCallConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const secrets = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const env = {
    get: jest.fn((key: string) => {
      if (key === 'API_URL') return 'https://api.minegocio.com';
      return undefined;
    }),
  };
  const vapi = {
    listPhoneNumbers: jest.fn(),
    getPhoneNumber: jest.fn(),
    updatePhoneNumber: jest.fn(),
  };

  const service = new CallConfigService(
    prisma as never,
    secrets as never,
    businesses as never,
    env as never,
    vapi as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('getPublic nunca expone la API key ni el webhookSecret', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({
      businessId: 'biz-1',
      vapiApiKeyEnc: 'enc:secret',
      phoneNumberId: 'pn_1',
      phoneNumberE164: '+5491100000000',
      voiceProvider: 'vapi',
      voiceId: 'Elliot',
      transcriberLanguage: null,
      firstMessage: null,
      webhookSecret: 'ssh',
      enabled: true,
      agentEnabled: true,
      status: 'connected',
      lastError: null,
      lastSyncedAt: new Date('2026-09-02T10:00:00Z'),
    });

    const pub = await service.getPublic();

    expect(pub).toMatchObject({ hasApiKey: true, phoneNumberId: 'pn_1', enabled: true });
    expect(JSON.stringify(pub)).not.toContain('secret');
    expect(JSON.stringify(pub)).not.toContain('ssh');
    expect(pub?.webhookUrl).toBe('https://api.minegocio.com/api/webhooks/vapi');
  });

  it('upsert cifra la API key nueva y genera webhookSecret si falta', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue(null);
    prisma.vapiCallConfig.upsert.mockImplementation(async ({ create }: any) => ({
      ...create,
      lastSyncedAt: null,
    }));

    await service.upsert({ vapiApiKey: 'vapi-key-123', enabled: false });

    const call = prisma.vapiCallConfig.upsert.mock.calls[0][0];
    expect(call.create.vapiApiKeyEnc).toBe('enc:vapi-key-123');
    expect(typeof call.create.webhookSecret).toBe('string');
    expect(call.create.webhookSecret.length).toBeGreaterThan(16);
    // sin phoneNumberId → no toca Vapi
    expect(vapi.updatePhoneNumber).not.toHaveBeenCalled();
  });

  it('upsert con phoneNumberId apunta el server.url y limpia assistantId', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({
      businessId: 'biz-1',
      vapiApiKeyEnc: 'enc:k',
      webhookSecret: 'existing-secret',
      phoneNumberId: null,
      voiceProvider: 'vapi',
      voiceId: 'Elliot',
      enabled: false,
      agentEnabled: true,
    });
    prisma.vapiCallConfig.upsert.mockImplementation(async ({ update }: any) => ({
      businessId: 'biz-1',
      vapiApiKeyEnc: 'enc:k',
      webhookSecret: 'existing-secret',
      phoneNumberId: 'pn_9',
      phoneNumberE164: '+5491100000000',
      voiceProvider: 'vapi',
      voiceId: 'Elliot',
      transcriberLanguage: null,
      firstMessage: null,
      enabled: true,
      agentEnabled: true,
      status: 'connected',
      lastError: null,
      lastSyncedAt: new Date(),
      ...update,
    }));
    vapi.getPhoneNumber.mockResolvedValue({ id: 'pn_9', provider: 'twilio', number: '+5491100000000' });
    vapi.updatePhoneNumber.mockResolvedValue(undefined);

    await service.upsert({ phoneNumberId: 'pn_9', enabled: true });

    expect(vapi.updatePhoneNumber).toHaveBeenCalledWith(
      'k',
      'pn_9',
      expect.objectContaining({
        assistantId: null,
        squadId: null,
        server: {
          url: 'https://api.minegocio.com/api/webhooks/vapi',
          secret: 'existing-secret',
        },
      }),
    );
  });

  it('upsert no rompe el guardado si Vapi falla; deja status error', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({
      businessId: 'biz-1', vapiApiKeyEnc: 'enc:k', webhookSecret: 's',
      voiceProvider: 'vapi', voiceId: 'Elliot', enabled: false, agentEnabled: true,
    });
    prisma.vapiCallConfig.upsert.mockImplementation(async () => ({
      businessId: 'biz-1', vapiApiKeyEnc: 'enc:k', webhookSecret: 's',
      phoneNumberId: 'pn_9', phoneNumberE164: null, voiceProvider: 'vapi', voiceId: 'Elliot',
      transcriberLanguage: null, firstMessage: null, enabled: true, agentEnabled: true,
      status: 'connected', lastError: null, lastSyncedAt: null,
    }));
    vapi.getPhoneNumber.mockRejectedValue(new Error('boom'));

    const pub = await service.upsert({ phoneNumberId: 'pn_9', enabled: true });

    expect(pub.status).toBe('error');
    expect(pub.lastError).toContain('boom');
    expect(prisma.vapiCallConfig.updateMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1' },
      data: { status: 'error', lastError: expect.stringContaining('boom') },
    });
  });

  it('getApiKey cae a env VAPI_API_KEY si no hay una guardada', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({ businessId: 'biz-1', vapiApiKeyEnc: null });
    env.get.mockImplementation((k: string) => (k === 'VAPI_API_KEY' ? 'env-key' : undefined));

    expect(await service.getApiKey()).toBe('env-key');
  });
});
