import { VapiBridgeService } from './vapi-bridge.service';

function mockRes() {
  const chunks: string[] = [];
  return {
    chunks,
    headersSent: false,
    writeHead: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn((s: string) => {
      chunks.push(s);
      return true;
    }),
    end: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('VapiBridgeService', () => {
  const prisma = { conversation: { findFirst: jest.fn(), create: jest.fn() } };
  const agent = { run: jest.fn() };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const callLog = { startInboundCall: jest.fn() };
  const service = new VapiBridgeService(
    prisma as never,
    agent as never,
    businesses as never,
    callLog as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv_1', contactPhone: '+549110' });
    agent.run.mockResolvedValue({ conversationId: 'conv_1', message: 'Hola, ¿en qué te ayudo?', status: 'AI' });
  });

  it('corre el agente con channel VOICE y maxStepsOverride, y emite SSE', async () => {
    const res = mockRes();
    await service.handleChatCompletion(
      {
        stream: true,
        call: { id: 'call_1' },
        metadata: { businessId: 'biz-1' },
        messages: [
          { role: 'system', content: 'x' },
          { role: 'user', content: 'hola' },
        ],
      } as never,
      res as never,
    );

    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      conversationId: 'conv_1',
      channel: 'VOICE',
      message: 'hola',
      maxStepsOverride: 4,
    }));
    const body = res.chunks.join('');
    expect(body).toContain('"content":"Hola, ¿en qué te ayudo?"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('data: [DONE]');
    expect(res.end).toHaveBeenCalled();
  });

  it('stream=false responde JSON chat.completion', async () => {
    const res = mockRes();
    await service.handleChatCompletion(
      { stream: false, call: { id: 'call_1' }, metadata: { businessId: 'biz-1' },
        messages: [{ role: 'user', content: 'hola' }] } as never,
      res as never,
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      object: 'chat.completion',
      choices: [expect.objectContaining({ message: { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' } })],
    }));
  });

  it('si agent.run explota, emite un chunk de fallback y no lanza', async () => {
    agent.run.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await expect(service.handleChatCompletion(
      { stream: true, call: { id: 'call_1' }, metadata: { businessId: 'biz-1' },
        messages: [{ role: 'user', content: 'hola' }] } as never,
      res as never,
    )).resolves.toBeUndefined();
    const body = res.chunks.join('');
    expect(body).toContain('data: [DONE]');
    expect(body.toLowerCase()).toMatch(/problema|repet/);
  });

  it('body nulo no lanza y aún produce una respuesta', async () => {
    const res = mockRes();
    await expect(
      service.handleChatCompletion(null as never, res as never),
    ).resolves.toBeUndefined();
    expect(agent.run).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    const body = res.chunks.join('');
    expect(body).toContain('data: [DONE]');
  });

  it('turno sin mensaje de usuario: no llama al agente pero emite stop + [DONE]', async () => {
    const res = mockRes();
    await service.handleChatCompletion(
      {
        stream: true,
        call: { id: 'call_1' },
        metadata: { businessId: 'biz-1' },
        messages: [
          { role: 'system', content: 'x' },
          { role: 'user', content: '   ' },
        ],
      } as never,
      res as never,
    );
    expect(agent.run).not.toHaveBeenCalled();
    const body = res.chunks.join('');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('data: [DONE]');
    expect(res.end).toHaveBeenCalled();
  });

  it('si res.write explota, no lanza', async () => {
    const res = mockRes();
    res.write.mockImplementationOnce(() => {
      throw new Error('socket dead');
    });
    await expect(
      service.handleChatCompletion(
        { stream: true, call: { id: 'call_1' }, metadata: { businessId: 'biz-1' },
          messages: [{ role: 'user', content: 'hola' }] } as never,
        res as never,
      ),
    ).resolves.toBeUndefined();
  });

  it('crea la conversación VOICE si no existe', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conv_new', contactPhone: null });
    const res = mockRes();
    await service.handleChatCompletion(
      { stream: true, call: { id: 'call_2' }, metadata: { businessId: 'biz-1' },
        customer: { number: '+549112' },
        messages: [{ role: 'user', content: 'hola' }] } as never,
      res as never,
    );
    expect(prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 'biz-1', channel: 'VOICE', externalId: 'call_2' }),
    }));
    expect(callLog.startInboundCall).toHaveBeenCalled();
  });
});
