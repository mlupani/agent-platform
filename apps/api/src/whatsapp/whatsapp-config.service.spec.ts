import { WhatsAppConfigService } from './whatsapp-config.service';

describe('WhatsAppConfigService', () => {
  const prisma = {
    whatsAppConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const secrets = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const env = {
    get: jest.fn((key: string) => {
      if (key === 'API_URL') return 'http://localhost:3001';
      if (key === 'WAHA_BASE_URL') return 'http://localhost:3002';
      if (key === 'WAHA_API_KEY') return 'env-waha-key';
      return undefined;
    }),
  };

  const service = new WhatsAppConfigService(
    prisma as never,
    secrets as never,
    businesses as never,
    env as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    env.get.mockImplementation((key: string) => {
      if (key === 'API_URL') return 'http://localhost:3001';
      if (key === 'WAHA_BASE_URL') return 'http://localhost:3002';
      if (key === 'WAHA_API_KEY') return 'env-waha-key';
      return undefined;
    });
  });

  it('never returns raw WAHA API key in public config', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      id: 'wa-1',
      businessId: 'biz-1',
      provider: 'waha',
      wahaBaseUrl: 'http://localhost:3002',
      wahaApiKeyEnc: 'enc:super-secret-key',
      sessionName: 'default',
      phoneNumberId: null,
      businessAccountId: null,
      displayPhoneNumber: null,
      meId: null,
      verifyToken: null,
      accessTokenEnc: null,
      enabled: true,
      status: 'connected',
      sessionStatus: 'WORKING',
      lastError: null,
    });

    const publicConfig = await service.getPublic();
    expect(publicConfig).toMatchObject({
      hasWahaApiKey: true,
      webhookUrl: 'http://localhost:3001/api/webhooks/waha',
      provider: 'waha',
    });
    expect(JSON.stringify(publicConfig)).not.toContain('super-secret-key');
  });

  it('creates config from env when missing', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    prisma.whatsAppConfig.create.mockResolvedValue({
      id: 'wa-new',
      businessId: 'biz-1',
      provider: 'waha',
      wahaBaseUrl: 'http://localhost:3002',
      wahaApiKeyEnc: null,
      sessionName: 'default',
      phoneNumberId: null,
      businessAccountId: null,
      displayPhoneNumber: null,
      meId: null,
      verifyToken: null,
      accessTokenEnc: null,
      enabled: true,
      status: 'disconnected',
      sessionStatus: null,
      lastError: null,
    });

    const publicConfig = await service.getPublic();
    expect(prisma.whatsAppConfig.create).toHaveBeenCalled();
    expect(publicConfig?.hasWahaApiKey).toBe(true);
    expect(JSON.stringify(publicConfig)).not.toContain('env-waha-key');
  });

  it('keeps previous WAHA key when upsert omits wahaApiKey', async () => {
    prisma.whatsAppConfig.findUnique.mockResolvedValue({
      wahaApiKeyEnc: 'enc:old',
      accessTokenEnc: null,
      enabled: true,
      provider: 'waha',
      wahaBaseUrl: 'http://localhost:3002',
      sessionName: 'default',
    });
    prisma.whatsAppConfig.upsert.mockResolvedValue({
      id: 'wa-1',
      businessId: 'biz-1',
      provider: 'waha',
      wahaBaseUrl: 'http://waha:3000',
      wahaApiKeyEnc: 'enc:old',
      sessionName: 'default',
      phoneNumberId: null,
      businessAccountId: null,
      displayPhoneNumber: null,
      meId: null,
      verifyToken: null,
      accessTokenEnc: null,
      enabled: true,
      status: 'disconnected',
      sessionStatus: null,
      lastError: null,
    });

    await service.upsert({
      wahaBaseUrl: 'http://waha:3000',
      enabled: true,
    });

    expect(secrets.encrypt).not.toHaveBeenCalled();
    expect(prisma.whatsAppConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({
          wahaApiKeyEnc: expect.anything(),
        }),
      }),
    );
  });
});
