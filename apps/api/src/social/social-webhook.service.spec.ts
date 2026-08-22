import { createHmac } from 'crypto';
import { SocialWebhookService } from './social-webhook.service';
import { SocialWebhookSignatureError } from './social.errors';

describe('SocialWebhookService', () => {
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn(),
  };
  const publishing = {
    upsertFromWebhook: jest.fn().mockResolvedValue({ applied: true }),
    updatePublicationByExternalId: jest.fn().mockResolvedValue({ applied: true }),
  };
  const inbox = {
    handleMessageEvent: jest.fn().mockResolvedValue(true),
  };
  const config = {
    get: (key: string) =>
      key === 'ZERNIO_WEBHOOK_SECRET' ? 'whsec_test' : undefined,
  };

  const service = new SocialWebhookService(
    config as never,
    redis as never,
    publishing as never,
    inbox as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    redis.acquireLock.mockResolvedValue(true);
  });

  function signed(body: object) {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', 'whsec_test')
      .update(rawBody)
      .digest('hex');
    return { rawBody, signature, payload: body };
  }

  it('rechaza firma inválida', async () => {
    const rawBody = Buffer.from('{"event":"account.disconnected"}');
    await expect(
      service.handle({
        rawBody,
        signature: 'deadbeef',
        payload: { event: 'account.disconnected' },
      }),
    ).rejects.toBeInstanceOf(SocialWebhookSignatureError);
    expect(publishing.upsertFromWebhook).not.toHaveBeenCalled();
  });

  it('acepta account.disconnected con HMAC válido', async () => {
    const payload = {
      event: 'account.disconnected',
      account: {
        accountId: 'acc_1',
        profileId: 'prof_1',
        platform: 'instagram',
      },
    };
    const result = await service.handle({
      ...signed(payload),
      eventId: 'evt_1',
    });
    expect(result).toEqual({ ok: true, applied: true });
    expect(publishing.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc_1',
        status: 'disconnected',
      }),
    );
  });

  it('es idempotente con el mismo event id', async () => {
    redis.acquireLock.mockResolvedValue(false);
    const payload = { event: 'account.disconnected', accountId: 'acc_1' };
    const result = await service.handle({
      ...signed(payload),
      eventId: 'evt_dup',
    });
    expect(result.duplicate).toBe(true);
    expect(publishing.upsertFromWebhook).not.toHaveBeenCalled();
  });

  it('despacha message.received al inbox', async () => {
    const payload = {
      event: 'message.received',
      message: {
        id: 'msg_1',
        conversationId: 'conv_1',
        text: 'Hola',
        sender: { id: 'ig_user', username: 'jane' },
      },
      account: { accountId: 'acc_ig', platform: 'instagram' },
    };
    const result = await service.handle({
      ...signed(payload),
      eventId: 'evt_msg',
    });
    expect(result).toEqual({ ok: true, applied: true });
    expect(inbox.handleMessageEvent).toHaveBeenCalledWith(payload);
    expect(publishing.upsertFromWebhook).not.toHaveBeenCalled();
  });
});
