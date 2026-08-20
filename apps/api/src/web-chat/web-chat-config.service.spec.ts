import { WebChatConfigService } from './web-chat-config.service';
import { hashWidgetApiKey } from './web-chat-api-key.util';

describe('WebChatConfigService', () => {
  const prisma = {
    webChatConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const env = {
    get: jest.fn((key: string) => {
      if (key === 'API_URL') return 'http://localhost:3001';
      return undefined;
    }),
  };

  const service = new WebChatConfigService(
    prisma as never,
    businesses as never,
    env as never,
  );

  const baseConfig = {
    id: 'web-1',
    businessId: 'biz-1',
    enabled: false,
    status: 'disconnected',
    apiKeyHash: null,
    apiKeyPrefix: null,
    allowedOrigins: [] as string[],
    lastError: null,
    lastUsedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.webChatConfig.findUnique.mockResolvedValue(baseConfig);
  });

  it('never returns the raw API key in public config', async () => {
    prisma.webChatConfig.findUnique.mockResolvedValue({
      ...baseConfig,
      enabled: true,
      status: 'connected',
      apiKeyHash: hashWidgetApiKey('nlw_super-secret-key'),
      apiKeyPrefix: 'nlw_super-se',
    });

    const publicConfig = await service.getPublic();
    expect(publicConfig).toMatchObject({
      hasApiKey: true,
      apiKeyPrefix: 'nlw_super-se',
      widgetUrl: 'http://localhost:3001/api/widget/messages',
    });
    expect(JSON.stringify(publicConfig)).not.toContain('nlw_super-secret-key');
  });

  it('creates config when missing', async () => {
    prisma.webChatConfig.findUnique.mockResolvedValue(null);
    prisma.webChatConfig.create.mockResolvedValue(baseConfig);

    const publicConfig = await service.getPublic();
    expect(prisma.webChatConfig.create).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        enabled: false,
        status: 'disconnected',
      },
    });
    expect(publicConfig.enabled).toBe(false);
  });

  it('returns plaintext key only when generating', async () => {
    prisma.webChatConfig.update.mockImplementation(async ({ data }) => ({
      ...baseConfig,
      ...data,
    }));

    const result = await service.generateApiKey();
    expect(result.apiKey.startsWith('nlw_')).toBe(true);
    expect(result.config.hasApiKey).toBe(true);
    expect(result.config.enabled).toBe(true);
    expect(result.config.status).toBe('connected');
    expect(prisma.webChatConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          status: 'connected',
          apiKeyHash: expect.any(String),
          apiKeyPrefix: expect.stringMatching(/^nlw_/),
        }),
      }),
    );
  });

  it('does not enable without an API key', async () => {
    prisma.webChatConfig.update.mockImplementation(async ({ data }) => ({
      ...baseConfig,
      ...data,
    }));

    const publicConfig = await service.upsertSettings({ enabled: true });
    expect(publicConfig.enabled).toBe(false);
    expect(publicConfig.status).toBe('disconnected');
    expect(publicConfig.lastError).toContain('API key');
  });
});
