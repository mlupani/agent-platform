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
    memoryStrategy: { recentMessages: 4, includeSummary: true, semanticTopK: 0 },
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
    message: { create: jest.fn(), findMany: jest.fn() },
    agentExecution: { create: jest.fn(), update: jest.fn() },
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
    formatHours: jest.fn(() => 'Lunes: 09:00–18:00'),
    formatServices: jest.fn(() => '- Consulta (30 min)'),
  };
  const memory = {
    parseStrategy: jest.fn(() => agentConfig.memoryStrategy),
    getRecentMessages: jest.fn(async () => [
      { role: 'user', content: 'Hola' },
    ]),
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

  const service = new AgentService(
    prisma as never,
    llmRouting as never,
    promptBuilder as never,
    memory as never,
    rag as never,
    tools as never,
    registry as never,
    guardrails as never,
    costControl as never,
    cost as never,
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
    prisma.message.findMany.mockResolvedValue([]);
    prisma.agentExecution.create.mockResolvedValue({ id: 'exec-1' });
    prisma.agentExecution.update.mockResolvedValue({});
    providers.get.mockReturnValue(llm);
    llmRouting.resolvePrimary.mockReturnValue({
      providerName: 'openai',
      model: 'gpt-4.1-mini',
      provider: llm,
      mode: 'openai' as const,
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
    (llm.chat as jest.Mock).mockResolvedValue({
      content: null,
      toolCalls: [
        { id: 'call-x', name: 'getBusinessInformation', arguments: '{}' },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'gpt-4.1-mini',
      finishReason: 'tool_calls',
    });
    tools.execute.mockResolvedValue({ success: true, data: {} });

    const result = await service.run({
      businessId: 'biz-1',
      conversationId: 'conv-1',
      message: 'loop',
    });

    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(result.message).toMatch(/límite de pasos/i);
  });
});
