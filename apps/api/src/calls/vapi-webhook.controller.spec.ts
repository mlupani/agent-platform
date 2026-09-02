import { UnauthorizedException } from '@nestjs/common';
import { VapiWebhookController } from './vapi-webhook.controller';

describe('VapiWebhookController', () => {
  const webhook = { verifySecret: jest.fn(), handleEvent: jest.fn() };
  const bridge = { handleChatCompletion: jest.fn() };
  const controller = new VapiWebhookController(webhook as never, bridge as never);

  beforeEach(() => jest.clearAllMocks());

  it('rechaza eventos sin secret válido', async () => {
    webhook.verifySecret.mockResolvedValue(false);
    await expect(
      controller.events({ 'x-vapi-secret': 'bad' } as never, { message: { type: 'status-update' } }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enruta el evento cuando el secret es válido', async () => {
    webhook.verifySecret.mockResolvedValue(true);
    webhook.handleEvent.mockResolvedValue({ ok: true });
    const out = await controller.events(
      { 'x-vapi-secret': 'good' } as never,
      { message: { type: 'status-update', status: 'ended' } },
    );
    expect(webhook.handleEvent).toHaveBeenCalledWith({ type: 'status-update', status: 'ended' });
    expect(out).toEqual({ ok: true });
  });

  it('chat/completions valida el secret y delega en el bridge', async () => {
    webhook.verifySecret.mockResolvedValue(true);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
    await controller.chatCompletions(
      { 'x-vapi-secret': 'good' } as never,
      { call: { id: 'c1' } } as never,
      res as never,
    );
    expect(bridge.handleChatCompletion).toHaveBeenCalledWith({ call: { id: 'c1' } }, res);
  });

  it('chat/completions rechaza secret inválido', async () => {
    webhook.verifySecret.mockResolvedValue(false);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await expect(
      controller.chatCompletions({ 'x-vapi-secret': 'bad' } as never, {} as never, res as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
