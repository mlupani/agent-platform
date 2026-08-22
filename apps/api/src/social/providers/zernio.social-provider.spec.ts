import { RateLimitError, ZernioApiError } from '@zernio/node';
import { ZernioSocialProvider } from './zernio.social-provider';
import {
  SocialAuthError,
  SocialNotConfiguredError,
  SocialRateLimitError,
} from '../social.errors';

const mockSdk = {
  connect: { getConnectUrl: jest.fn() },
  profiles: { createProfile: jest.fn(), getProfile: jest.fn() },
  accounts: {
    listAccounts: jest.fn(),
    deleteAccount: jest.fn(),
    getAccountHealth: jest.fn(),
  },
  posts: { createPost: jest.fn() },
  messages: {
    sendInboxMessage: jest.fn(),
    listInboxConversations: jest.fn(),
    getInboxConversationMessages: jest.fn(),
  },
};

jest.mock('@zernio/node', () => {
  class MockZernioApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) {
      super(message);
      this.name = 'ZernioApiError';
      this.statusCode = statusCode;
    }
    isAuthError() {
      return this.statusCode === 401;
    }
    isNotFound() {
      return this.statusCode === 404;
    }
  }
  class MockRateLimitError extends MockZernioApiError {
    constructor(message: string) {
      super(message, 429);
      this.name = 'RateLimitError';
    }
  }
  return {
    Zernio: jest.fn(() => mockSdk),
    ZernioApiError: MockZernioApiError,
    RateLimitError: MockRateLimitError,
  };
});

describe('ZernioSocialProvider', () => {
  const config = {
    get: (key: string) => (key === 'ZERNIO_API_KEY' ? 'test-key' : undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publica un reel de Instagram', async () => {
    mockSdk.posts.createPost.mockResolvedValue({
      data: { post: { _id: 'post_reel', status: 'published' } },
    });
    const provider = new ZernioSocialProvider(config as never);
    const result = await provider.publish({
      accountId: 'acc_ig',
      platform: 'instagram',
      contentType: 'reel',
      mediaUrl: 'https://cdn.example/video.mp4',
      mediaKind: 'video',
      caption: 'Reel de prueba',
    });
    expect(result.externalId).toBe('post_reel');
    expect(mockSdk.posts.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          publishNow: true,
          platforms: [
            expect.objectContaining({
              platform: 'instagram',
              accountId: 'acc_ig',
            }),
          ],
        }),
      }),
    );
  });

  it('publica un video de TikTok con consent flags', async () => {
    mockSdk.posts.createPost.mockResolvedValue({
      data: { post: { _id: 'post_tt', status: 'publishing' } },
    });
    const provider = new ZernioSocialProvider(config as never);
    const result = await provider.publish({
      accountId: 'acc_tt',
      platform: 'tiktok',
      contentType: 'video',
      mediaUrl: 'https://cdn.example/video.mp4',
      mediaKind: 'video',
      caption: 'TikTok de prueba',
    });
    expect(result.externalId).toBe('post_tt');
    expect(mockSdk.posts.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          tiktokSettings: expect.objectContaining({
            contentPreviewConfirmed: true,
            expressConsentGiven: true,
          }),
        }),
      }),
    );
  });

  it('mapea RateLimitError a mensaje de usuario', async () => {
    mockSdk.posts.createPost.mockRejectedValue(
      new RateLimitError('too many requests'),
    );
    const provider = new ZernioSocialProvider(config as never);
    await expect(
      provider.publish({
        accountId: 'acc_ig',
        platform: 'instagram',
        contentType: 'feed',
        mediaUrl: 'https://cdn.example/img.jpg',
        mediaKind: 'image',
      }),
    ).rejects.toBeInstanceOf(SocialRateLimitError);
  });

  it('mapea 401 a SocialAuthError', async () => {
    mockSdk.accounts.listAccounts.mockRejectedValue(
      new ZernioApiError('unauthorized', 401),
    );
    const provider = new ZernioSocialProvider(config as never);
    await expect(provider.listAccounts('prof_1')).rejects.toBeInstanceOf(
      SocialAuthError,
    );
  });

  it('falla sin API key', async () => {
    const empty = { get: () => undefined };
    const provider = new ZernioSocialProvider(empty as never);
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.listAccounts('prof_1')).rejects.toBeInstanceOf(
      SocialNotConfiguredError,
    );
  });

  it('envía un DM de Instagram al inbox de Zernio', async () => {
    mockSdk.messages.sendInboxMessage.mockResolvedValue({
      data: { data: { messageId: 'mid_1' } },
    });
    const provider = new ZernioSocialProvider(config as never);
    const result = await provider.sendInboxMessage({
      accountId: 'acc_ig',
      conversationId: 'conv_1',
      message: 'Hola',
    });
    expect(result.externalId).toBe('mid_1');
    expect(mockSdk.messages.sendInboxMessage).toHaveBeenCalledWith({
      path: { conversationId: 'conv_1' },
      body: { accountId: 'acc_ig', message: 'Hola' },
    });
  });
});
