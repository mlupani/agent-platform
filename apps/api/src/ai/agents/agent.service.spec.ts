import { z } from 'zod';
import { AgentService } from './agent.service';
import type { LLMProvider } from '../providers/llm-provider.interface';

describe('AgentService', () => {
  const business = {
    id: 'biz-1',
    name: 'Demo Business',
    description: 'Demo',
    type: 'OTHER',
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es',
    address: null,
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    instagram: null,
    googleReviewsUrl: null,
    additionalInfo: null,
    defaultMessages: { welcome: 'Hola' },
    allowedModels: ['gpt-4.1-mini'],
    dailyRequestLimit: 100,
    dailyTokenLimit: 10_000,
  };
  const agentConfig = {
    id: 'agent-1',
    businessId: 'biz-1',
    name: 'Asistente Demo',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    systemPrompt: 'Sos un asistente demo.',
    tone: 'professional_warm',
    customInstructions: 'Sé breve.',
    personality: 'claro',
    temperature: 0.2,
    maxTokens: 256,
    maxSteps: 3,
    knowledgeBaseId: null,
    enabledTools: ['getBusinessInformation'],
    memoryStrategy: {
      recentMessages: 4,
      includeSummary: true,
      semanticTopK: 0,
    },
  };
  const conversation = {
    id: 'conv-1',
    businessId: 'biz-1',
    userId: null,
    channel: 'WEB',
    status: 'AI',
    summary: null,
  };

  const prisma = {
    business: { findUnique: jest.fn() },
    businessHour: { findMany: jest.fn() },
    service: { findMany: jest.fn() },
    agentConfig: { findFirst: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    agentExecution: { create: jest.fn(), update: jest.fn() },
    toolExecution: { findFirst: jest.fn() },
  };

  const llm: LLMProvider = {
    name: 'mock',
    chat: jest.fn(),
    stream: jest.fn(),
    embeddings: jest.fn(),
  };

  const providers = { get: jest.fn(() => llm) };
  const llmRouting = {
    resolvePrimary: jest.fn(() => ({
      providerName: 'openai',
      model: 'gpt-4.1-mini',
      provider: llm,
      mode: 'openai' as const,
    })),
    resolveFallback: jest.fn(() => null),
    isRetryableLlmError: jest.fn(() => false),
    getMode: jest.fn(() => 'openai' as const),
    getGeminiModel: jest.fn(() => 'gemini-2.5-flash-lite'),
  };
  const promptBuilder = {
    buildFromContext: jest.fn(() => 'system prompt'),
    buildCurrentDateTime: jest.fn(() => ({
      date: '2026-08-11',
      time: '12:00',
      weekday: 'martes',
      tomorrowDate: '2026-08-12',
      tomorrowWeekday: 'miércoles',
      timezone: 'America/Argentina/Buenos_Aires',
    })),
    formatHours: jest.fn(() => 'Lunes: 09:00–18:00'),
    formatServices: jest.fn(() => '- Consulta (30 min)'),
  };
  const memory = {
    parseStrategy: jest.fn(() => agentConfig.memoryStrategy),
    getRecentMessages: jest.fn(async () => [{ role: 'user', content: 'Hola' }]),
    getLongTermContext: jest.fn(async () => ''),
  };
  const rag = {
    search: jest.fn(),
    formatContext: jest.fn(() => ''),
  };
  const tools = { execute: jest.fn() };
  const registry = {
    getAvailableTools: jest.fn(() => [
      {
        name: 'getBusinessInformation',
        description: 'info',
        schema: z.object({}),
      },
    ]),
  };
  const guardrails = {
    sanitizeUserInput: jest.fn((value: string) => value.trim()),
    isBlockedConversationStatus: jest.fn(
      (status: string) => status === 'HUMAN' || status === 'WAITING_HUMAN',
    ),
  };
  const costControl = {
    assertWithinLimits: jest.fn(),
    incrementUsage: jest.fn(),
  };
  const cost = { estimate: jest.fn(() => 0.001) };
  const leadContext = { snapshot: jest.fn(async () => null) };
  const leads = { recordInbound: jest.fn(async () => {} ) };
  const studentContext = {
    resolveStudentContext: jest.fn(async () => ({
      relationshipStatus: 'PROSPECT',
      availableClasses: null,
      hasTrialAlreadyUsed: false,
      found: false,
      student: null,
      contact: {},
    })),
  };

  const service = new AgentService(
    prisma as never,
    llmRouting as never,
    promptBuilder as never,
    memory as never,
    rag as never,
    tools as never,
    registry as never,
    guardrails,
    costControl as never,
    cost,
    leadContext as never,
    leads as never,
    studentContext as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.business.findUnique.mockResolvedValue(business);
    prisma.businessHour.findMany.mockResolvedValue([]);
    prisma.service.findMany.mockResolvedValue([]);
    prisma.agentConfig.findFirst.mockResolvedValue(agentConfig);
    prisma.conversation.findFirst.mockResolvedValue(conversation);
    prisma.conversation.update.mockResolvedValue({});
    prisma.message.create.mockResolvedValue({});
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.findMany.mockResolvedValue([]);
    prisma.agentExecution.create.mockResolvedValue({ id: 'exec-1' });
    prisma.agentExecution.update.mockResolvedValue({});
    prisma.toolExecution.findFirst.mockResolvedValue(null);
    providers.get.mockReturnValue(llm);
    llmRouting.resolvePrimary.mockReturnValue({
      providerName: 'openai',
      model: 'gpt-4.1-mini',
      provider: llm,
      mode: 'openai' as const,
    });
  });

  it('does not increment unread when the inbound message was already persisted', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      ...conversation,
      status: 'HUMAN',
    });
    prisma.message.findFirst.mockResolvedValue({
      id: 'msg-1',
      sender: 'CLIENT',
      externalId: 'ext-1',
    });

    await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: 'Hola',
      metadata: { wamid: 'ext-1' },
    });

    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.not.objectContaining({
        unreadCount: expect.anything(),
      }),
    });
  });

  it('does not auto-reply when conversation is HUMAN but still stores the inbound message', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      ...conversation,
      status: 'HUMAN',
    });

    const result = await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: 'Hola',
    });

    expect(result.status).toBe('HUMAN');
    expect(llm.chat).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalled();
  });

  it('runs a simple LLM turn without tools', async () => {
    (llm.chat as jest.Mock).mockResolvedValue({
      content: 'Hola, ¿en qué ayudo?',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 8 },
      model: 'gpt-4.1-mini',
      finishReason: 'stop',
    });

    const result = await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: 'Hola',
      debug: true,
    });

    expect(result.message).toContain('Hola');
    expect(result.debug?.steps).toBe(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(2);
  });

  it('executes tool calls and continues the loop', async () => {
    (llm.chat as jest.Mock)
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'getBusinessInformation',
            arguments: '{}',
          },
        ],
        usage: { inputTokens: 12, outputTokens: 4 },
        model: 'gpt-4.1-mini',
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: 'Demo Business abre de 9 a 18.',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 9 },
        model: 'gpt-4.1-mini',
        finishReason: 'stop',
      });
    tools.execute.mockResolvedValue({
      success: true,
      data: { name: 'Demo Business' },
    });

    const result = await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: '¿Qué negocio sos?',
      debug: true,
    });

    expect(tools.execute).toHaveBeenCalledWith(
      'getBusinessInformation',
      {},
      expect.objectContaining({ businessId: 'biz-1' }),
    );
    expect(result.debug?.steps).toBe(2);
    expect(result.message).toContain('Demo Business');
  });

  it('stops at maxSteps to avoid infinite loops', async () => {
    (llm.chat as jest.Mock)
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'call-x', name: 'getBusinessInformation', arguments: '{}' },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'gpt-4.1-mini',
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'call-y', name: 'getBusinessInformation', arguments: '{}' },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'gpt-4.1-mini',
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: 'Acá va la info del negocio.',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'gpt-4.1-mini',
        finishReason: 'stop',
      });
    tools.execute.mockResolvedValue({ success: true, data: { name: 'Demo' } });

    const result = await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: 'loop',
    });

    // 1ª tool real + 2ª repetida corta el loop y fuerza respuesta sin tools
    expect(tools.execute).toHaveBeenCalledTimes(1);
    expect(result.message).toContain('Acá va la info del negocio.');
  });

  it('falls back to availability summary when the model never answers', async () => {
    const previousMaxSteps = agentConfig.maxSteps;
    const previousTools = agentConfig.enabledTools;
    agentConfig.maxSteps = 1;
    agentConfig.enabledTools = ['checkAvailability'];
    (llm.chat as jest.Mock)
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call-av',
            name: 'checkAvailability',
            arguments: '{"date":"2026-08-11"}',
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'gpt-4.1-mini',
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'gpt-4.1-mini',
        finishReason: 'stop',
      });
    registry.getAvailableTools.mockReturnValue([
      {
        name: 'checkAvailability',
        description: 'dispo',
        schema: z.object({ date: z.string() }),
      },
    ]);
    tools.execute.mockResolvedValue({
      success: true,
      data: {
        date: '2026-08-11',
        dayLabel: 'martes',
        slots: [{ start: '09:00', end: '09:30' }],
      },
    });

    const result = await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: 'hay turnos?',
    });

    expect(result.message).toMatch(/09:00|martes|horarios libres/i);
    agentConfig.maxSteps = previousMaxSteps;
    agentConfig.enabledTools = previousTools;
  });
});
