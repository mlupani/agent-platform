import { SocialPublishingService } from './social-publishing.service';
import { SocialAccountNotFoundError, SocialOAuthError } from './social.errors';

describe('SocialPublishingService', () => {
  const prisma = {
    business: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    socialConnection: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    contentPublication: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };
  const provider = {
    name: 'zernio' as const,
    isConfigured: jest.fn(() => true),
    createProfile: jest.fn(),
    getProfile: jest.fn(),
    getConnectUrl: jest.fn(),
    listAccounts: jest.fn(),
    getAccount: jest.fn(),
    disconnect: jest.fn(),
    getAccountHealth: jest.fn(),
    publish: jest.fn(),
  };
  const factory = { get: () => provider };
  const config = {
    get: (key: string, fallback?: string) => {
      if (key === 'ZERNIO_REDIRECT_URI') {
        return 'http://localhost:3001/api/social/oauth/callback';
      }
      if (key === 'ADMIN_URL') return 'http://localhost:3000';
      if (key === 'API_URL') return 'http://localhost:3001';
      return fallback;
    },
  };
  const inbox = {
    backfillFromZernio: jest.fn().mockResolvedValue(0),
    purgeChats: jest.fn().mockResolvedValue(0),
  };

  const service = new SocialPublishingService(
    prisma as never,
    redis as never,
    factory as never,
    config as never,
    inbox as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    provider.isConfigured.mockReturnValue(true);
  });

  it('crea profile Zernio y persiste al conectar', async () => {
    prisma.business.findUnique.mockResolvedValue({
      id: 'biz-a',
      slug: 'lumina',
      name: 'Lumina',
      zernioProfileId: null,
    });
    provider.createProfile.mockResolvedValue({ id: 'prof_1' });
    provider.getConnectUrl.mockResolvedValue({
      authUrl: 'https://zernio.com/oauth',
    });

    const result = await service.getConnectUrl('biz-a', 'instagram');

    expect(provider.createProfile).toHaveBeenCalled();
    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-a' },
      data: { zernioProfileId: 'prof_1' },
    });
    expect(redis.set).toHaveBeenCalled();
    expect(result.authUrl).toBe('https://zernio.com/oauth');
  });

  it('callback con nonce válido upserta la conexión', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ businessId: 'biz-a', platform: 'instagram' }),
    );
    prisma.business.findUnique.mockResolvedValue({
      id: 'biz-a',
      zernioProfileId: 'prof_1',
    });
    provider.getAccount.mockResolvedValue({
      id: 'acc_1',
      platform: 'instagram',
      profileId: 'prof_1',
      username: 'lumina',
      displayName: 'Lumina',
      avatarUrl: null,
    });
    prisma.socialConnection.upsert.mockResolvedValue({});

    const result = await service.handleOAuthCallback({
      n: 'nonce-ok',
      connected: 'instagram',
      profileId: 'prof_1',
      accountId: 'acc_1',
      username: 'lumina',
    });

    expect(prisma.socialConnection.upsert).toHaveBeenCalled();
    expect(result.adminRedirect).toContain('connected=instagram');
    expect(redis.del).toHaveBeenCalled();
  });

  it('rechaza nonce inválido', async () => {
    redis.get.mockResolvedValue(null);
    const result = await service.handleOAuthCallback({
      n: 'bad',
      accountId: 'acc_1',
      connected: 'instagram',
    });
    expect(result.adminRedirect).toContain('socialError=');
    expect(prisma.socialConnection.upsert).not.toHaveBeenCalled();
  });

  it('traduce no_facebook_pages al volver del OAuth', async () => {
    const result = await service.handleOAuthCallback({
      error: 'no_facebook_pages',
    });
    const url = new URL(result.adminRedirect);
    expect(url.searchParams.get('socialPlatform')).toBe('facebook');
    expect(url.searchParams.get('socialError')).toMatch(/Página/);
    expect(url.searchParams.get('socialError')).not.toMatch(/no_facebook_pages/);
  });

  it('no deja usar la cuenta de otro tenant', async () => {
    prisma.socialConnection.findFirst.mockResolvedValue(null);
    await expect(
      service.publish({
        businessId: 'biz-b',
        platform: 'instagram',
        contentType: 'reel',
        mediaUrl: 'https://cdn.example/v.mp4',
        mediaKind: 'video',
      }),
    ).rejects.toBeInstanceOf(SocialAccountNotFoundError);
    expect(provider.publish).not.toHaveBeenCalled();
  });

  it('desconecta en Zernio y marca local', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      businessId: 'biz-a',
      platform: 'instagram',
      externalAccountId: 'acc_1',
    });
    prisma.socialConnection.update.mockResolvedValue({
      platform: 'instagram',
      status: 'disconnected',
    });
    const result = await service.disconnect('biz-a', 'instagram');
    expect(provider.disconnect).toHaveBeenCalledWith('acc_1');
    expect(inbox.purgeChats).toHaveBeenCalledWith('biz-a', 'instagram');
    expect(result.status).toBe('disconnected');
  });

  it('desconectar TikTok no toca el inbox', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue({
      id: 'conn-tt',
      businessId: 'biz-a',
      platform: 'tiktok',
      externalAccountId: 'acc_tt',
    });
    prisma.socialConnection.update.mockResolvedValue({
      platform: 'tiktok',
      status: 'disconnected',
    });
    await service.disconnect('biz-a', 'tiktok');
    expect(inbox.purgeChats).not.toHaveBeenCalled();
  });

  it('health de cuenta inexistente o de otro tenant da 404', async () => {
    prisma.socialConnection.findFirst.mockResolvedValue(null);
    await expect(service.getHealth('biz-b', 'tiktok')).rejects.toBeInstanceOf(
      SocialAccountNotFoundError,
    );
  });

  it('publica reel usando la cuenta del tenant', async () => {
    prisma.socialConnection.findFirst.mockResolvedValue({
      businessId: 'biz-a',
      platform: 'instagram',
      status: 'connected',
      externalAccountId: 'acc_ig',
    });
    provider.publish.mockResolvedValue({
      externalId: 'post_1',
      status: 'published',
    });
    const result = await service.publish({
      businessId: 'biz-a',
      platform: 'instagram',
      contentType: 'reel',
      mediaUrl: 'https://cdn.example/v.mp4',
      mediaKind: 'video',
      caption: 'hola',
    });
    expect(result.externalId).toBe('post_1');
    expect(provider.publish).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc_ig', contentType: 'reel' }),
    );
  });

  it('ignora disconnect de una cuenta que no está en nuestra DB', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue(null);
    const result = await service.upsertFromWebhook({
      accountId: 'acc_unknown',
      platform: 'instagram',
      status: 'disconnected',
    });
    expect(result.applied).toBe(false);
    expect(prisma.socialConnection.update).not.toHaveBeenCalled();
    expect(inbox.purgeChats).not.toHaveBeenCalled();
  });

  it('al desconectar Instagram por webhook borra el inbox', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      businessId: 'biz-a',
      platform: 'instagram',
    });
    prisma.socialConnection.update.mockResolvedValue({
      platform: 'instagram',
      status: 'disconnected',
    });
    const result = await service.upsertFromWebhook({
      accountId: 'acc_1',
      platform: 'instagram',
      status: 'disconnected',
    });
    expect(result.applied).toBe(true);
    expect(inbox.purgeChats).toHaveBeenCalledWith('biz-a', 'instagram');
  });

  it('al desconectar Facebook por webhook borra el inbox de Messenger', async () => {
    prisma.socialConnection.findUnique.mockResolvedValue({
      id: 'conn-fb',
      businessId: 'biz-a',
      platform: 'facebook',
    });
    prisma.socialConnection.update.mockResolvedValue({
      platform: 'facebook',
      status: 'disconnected',
    });
    const result = await service.upsertFromWebhook({
      accountId: 'acc_fb',
      platform: 'facebook',
      status: 'disconnected',
    });
    expect(result.applied).toBe(true);
    expect(inbox.purgeChats).toHaveBeenCalledWith('biz-a', 'facebook');
  });

  it('falla conectar si el negocio no existe', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(
      service.getConnectUrl('missing', 'instagram'),
    ).rejects.toBeInstanceOf(SocialOAuthError);
  });
});
