import { Logger } from '@nestjs/common';
import { END_CALL_PHRASES, VapiWebhookService } from './vapi-webhook.service';

describe('VapiWebhookService', () => {
  const prisma = { conversation: { findFirst: jest.fn(), create: jest.fn() } };
  const callConfig = {
    getForRuntime: jest.fn(),
    getWebhookSecret: jest.fn(async () => 'the-secret'),
    resolveWebhookUrl: jest.fn(() => 'https://api.x.com/api/webhooks/vapi'),
  };
  const callLog = { startInboundCall: jest.fn(), updateStatus: jest.fn(), finalizeFromReport: jest.fn() };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const prismaBusiness = { business: { findUnique: jest.fn() } };
  const leads = { capture: jest.fn() };
  const service = new VapiWebhookService(
    { ...prisma, ...prismaBusiness } as never,
    callConfig as never, callLog as never, businesses as never, leads as never,
  );

  const enabledConfig = {
    businessId: 'biz-1', enabled: true, agentEnabled: true, webhookSecret: 'the-secret',
    voiceProvider: 'vapi', voiceId: 'Elliot', transcriberLanguage: null, firstMessage: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    callConfig.getForRuntime.mockResolvedValue(enabledConfig);
    prismaBusiness.business.findUnique.mockResolvedValue({
      id: 'biz-1', name: 'Pilates X', defaultMessages: { welcome: 'Hola, soy el asistente.' },
    });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conv_1' });
  });

  it('verifySecret compara contra el secret del negocio', async () => {
    expect(await service.verifySecret('the-secret')).toBe(true);
    expect(await service.verifySecret('otro')).toBe(false);
    expect(await service.verifySecret(undefined)).toBe(false);
  });

  it('assistant-request habilitado devuelve assistant transitorio custom-llm', async () => {
    const out = await service.handleEvent({
      type: 'assistant-request',
      call: { id: 'call_1', customer: { number: '+549110' } },
    } as never);

    expect(out.assistant).toMatchObject({
      firstMessage: 'Hola, soy el asistente.',
      model: {
        provider: 'custom-llm',
        url: 'https://api.x.com/api/webhooks/vapi',
        headers: { 'x-vapi-secret': 'the-secret' },
      },
      voice: { provider: 'vapi', voiceId: 'Elliot', version: 2 },
      server: { url: 'https://api.x.com/api/webhooks/vapi', secret: 'the-secret' },
      metadata: { businessId: 'biz-1', source: 'inbound' },
    });
    expect(callLog.startInboundCall).toHaveBeenCalledWith(expect.objectContaining({ vapiCallId: 'call_1' }));
    expect(leads.capture).toHaveBeenCalledWith(expect.objectContaining({ phone: '+549110', source: 'VOICE' }));
  });

  it('el asistente transitorio puede cortar la llamada (endCallPhrases + tool endCall)', async () => {
    const out: any = await service.handleEvent({
      type: 'assistant-request',
      call: { id: 'call_1' },
    } as never);

    expect(out.assistant.endCallPhrases).toEqual(END_CALL_PHRASES);
    expect(END_CALL_PHRASES.length).toBeGreaterThan(0);
    expect(out.assistant.model.tools).toEqual([{ type: 'endCall' }]);
  });

  it('assistant-request devuelve error si el asistente está desactivado', async () => {
    callConfig.getForRuntime.mockResolvedValue({ ...enabledConfig, agentEnabled: false });
    const sinAgente = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);
    expect(sinAgente).toEqual({ error: expect.any(String) });
    expect(sinAgente.assistant).toBeUndefined();

    callConfig.getForRuntime.mockResolvedValue({ ...enabledConfig, enabled: false });
    const deshabilitado = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);
    expect(deshabilitado).toEqual({ error: expect.any(String) });
    expect(deshabilitado.assistant).toBeUndefined();
  });

  it('assistant-request: un fallo de bookkeeping no bloquea el assistant', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.conversation.create.mockRejectedValue(new Error('db down'));

    const out: any = await service.handleEvent({
      type: 'assistant-request',
      call: { id: 'call_1', customer: { number: '+549110' } },
    } as never);

    expect(out.assistant).toMatchObject({ model: { provider: 'custom-llm' } });
    expect(out.error).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('assistant-request: si no se puede cargar el negocio devuelve error', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prismaBusiness.business.findUnique.mockRejectedValue(new Error('db down'));

    const out = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);

    expect(out).toEqual({ error: expect.any(String) });
    expect(out.assistant).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('firstMessage cae al default si defaultMessages.welcome no es string', async () => {
    prismaBusiness.business.findUnique.mockResolvedValue({
      id: 'biz-1', name: 'Pilates X', defaultMessages: { welcome: 42 },
    });

    const out: any = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);

    expect(typeof out.assistant.firstMessage).toBe('string');
    expect(out.assistant.firstMessage).toBe('Hola, soy el asistente virtual. ¿En qué puedo ayudarte?');
  });

  it('transcriber sin language cuando transcriberLanguage es null', async () => {
    const out: any = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);
    expect(out.assistant.transcriber.language).toBeUndefined();
  });

  it('status-update delega en callLog.updateStatus', async () => {
    await service.handleEvent({ type: 'status-update', status: 'in-progress', call: { id: 'call_1' } } as never);
    expect(callLog.updateStatus).toHaveBeenCalledWith('call_1', 'in-progress');
  });

  it('end-of-call-report delega en callLog.finalizeFromReport', async () => {
    await service.handleEvent({
      type: 'end-of-call-report',
      call: { id: 'call_1' },
      endedReason: 'customer-ended-call',
      cost: 0.1,
      startedAt: '2026-09-02T10:00:00Z',
      endedAt: '2026-09-02T10:02:00Z',
      artifact: { transcript: 'hola...' },
      analysis: { summary: 'pidió turno' },
    } as never);
    expect(callLog.finalizeFromReport).toHaveBeenCalledWith(expect.objectContaining({
      vapiCallId: 'call_1', costUsd: 0.1, transcript: 'hola...', summary: 'pidió turno',
    }));
  });

  it('evento desconocido responde {}', async () => {
    expect(await service.handleEvent({ type: 'speech-update' } as never)).toEqual({});
  });

  it('hang loguea warn y responde {}', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const out = await service.handleEvent({ type: 'hang', call: { id: 'call_1' } } as never);
    expect(out).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('call_1'));
    warnSpy.mockRestore();
  });
});
