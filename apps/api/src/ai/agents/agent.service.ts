import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ConversationStatus } from '../../common/constants';
import { CostControlService } from '../../analytics/cost-control.service';
import { CostService } from '../../analytics/cost.service';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { MemoryService } from '../memory/memory.service';
import { PromptBuilderService } from '../prompts/prompt-builder.service';
import { LlmRoutingService } from '../providers/llm-routing.service';
import type {
  ChatRequest,
  ChatResponse,
  LlmMessage,
} from '../providers/llm-provider.interface';
import { RagService } from '../rag/rag.service';
import { ToolExecutorService } from '../tools/tool-executor.service';
import { ToolRegistry } from '../tools/tool-registry';
import type {
  AgentDebugInfo,
  AgentRunInput,
  AgentRunResult,
  ExecutedTool,
} from './agent.types';
import type { ConfiguredMessagesPrompt } from '../prompts/prompt.types';
import { DEFAULT_CONFIGURED_MESSAGES } from '../../common/constants';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmRouting: LlmRoutingService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly memory: MemoryService,
    private readonly rag: RagService,
    private readonly tools: ToolExecutorService,
    private readonly registry: ToolRegistry,
    private readonly guardrails: GuardrailsService,
    private readonly costControl: CostControlService,
    private readonly cost: CostService,
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const started = Date.now();
    const message = this.guardrails.sanitizeUserInput(input.message);
    if (!message) {
      throw new HttpException('Message is required', HttpStatus.BAD_REQUEST);
    }

    const business = await this.prisma.business.findUnique({
      where: { id: input.businessId },
    });
    if (!business) {
      throw new HttpException('Business not found', HttpStatus.NOT_FOUND);
    }

    const agentConfig = await this.resolveAgentConfig(
      input.businessId,
      input.agentConfigId,
    );

    let llmTarget = this.llmRouting.resolvePrimary(agentConfig);
    await this.costControl.assertWithinLimits(business.id, llmTarget.model);

    const conversation = await this.resolveConversation(input, agentConfig.id);

    const inboundExternalId = input.metadata?.wamid
      ? String(input.metadata.wamid)
      : undefined;

    const alreadyPersisted = inboundExternalId
      ? await this.prisma.message.findFirst({
          where: { businessId: business.id, externalId: inboundExternalId },
        })
      : null;

    if (this.guardrails.isBlockedConversationStatus(conversation.status)) {
      if (!alreadyPersisted) {
        await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            businessId: business.id,
            role: 'user',
            sender: 'CLIENT',
            content: message,
            status: 'received',
            externalId: inboundExternalId,
            metadata: input.metadata as object | undefined,
          },
        });
      }
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: message.slice(0, 280),
          lastMessageSender: 'CLIENT',
          unreadCount: { increment: 1 },
          contactName: input.metadata?.contactName
            ? String(input.metadata.contactName)
            : undefined,
          contactPhone: input.metadata?.contactPhone
            ? String(input.metadata.contactPhone)
            : undefined,
        },
      });

      return {
        conversationId: conversation.id,
        message:
          conversation.status === 'CLOSED'
            ? 'La conversación está cerrada.'
            : 'Esta conversación está siendo atendida por una persona.',
        status: conversation.status as ConversationStatus,
      };
    }

    if (alreadyPersisted) {
      if (alreadyPersisted.sender !== 'CLIENT') {
        await this.prisma.message.update({
          where: { id: alreadyPersisted.id },
          data: {
            role: 'user',
            sender: 'CLIENT',
            status: 'received',
            metadata: input.metadata as object | undefined,
          },
        });
      }
    } else {
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          businessId: business.id,
          role: 'user',
          sender: 'CLIENT',
          content: message,
          status: 'received',
          externalId: inboundExternalId,
          metadata: input.metadata as object | undefined,
        },
      });
    }
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: message.slice(0, 280),
        lastMessageSender: 'CLIENT',
      },
    });

    const strategy = this.memory.parseStrategy(agentConfig.memoryStrategy);
    const recentMessages = await this.memory.getRecentMessages(
      conversation.id,
      business.id,
      strategy.recentMessages,
    );
    const longTerm = await this.memory.getLongTermContext({
      businessId: business.id,
      query: message,
      userId: conversation.userId ?? undefined,
      topK: strategy.semanticTopK,
    });

    let ragChunks = [] as Awaited<ReturnType<RagService['search']>>;
    if (agentConfig.knowledgeBaseId) {
      ragChunks = await this.rag.search({
        businessId: business.id,
        query: message,
        knowledgeBaseId: agentConfig.knowledgeBaseId,
        topK: 5,
        minScore: 0.55,
      });
    }

    const [hours, services] = await Promise.all([
      this.prisma.businessHour.findMany({
        where: { businessId: business.id },
        orderBy: { dayOfWeek: 'asc' },
      }),
      this.prisma.service.findMany({
        where: { businessId: business.id, enabled: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const configuredMessages = this.parseConfiguredMessages(
      business.defaultMessages,
    );

    const currentDateTime = this.promptBuilder.buildCurrentDateTime(
      business.timezone,
    );

    const systemPrompt = this.promptBuilder.buildFromContext({
      assistantName: agentConfig.name,
      tone: agentConfig.tone ?? 'professional_warm',
      customInstructions: agentConfig.customInstructions,
      advancedInstructions: agentConfig.systemPrompt,
      personality: agentConfig.personality,
      business: {
        name: business.name,
        description: business.description,
        type: business.type,
        timezone: business.timezone,
        language: business.language,
        address: business.address,
        phone: business.phone,
        whatsapp: business.whatsapp,
        email: business.email,
        website: business.website,
        instagram: business.instagram,
        additionalInfo: business.additionalInfo,
      },
      currentDateTime,
      hoursText: this.promptBuilder.formatHours(hours),
      servicesText: this.promptBuilder.formatServices(services),
      configuredMessages,
      memoryContext: [
        strategy.includeSummary && conversation.summary
          ? `Resumen previo:\n${conversation.summary}`
          : '',
        longTerm ? `Hechos persistentes:\n${longTerm}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      knowledgeContext: this.rag.formatContext(ragChunks),
      enabledTools: agentConfig.enabledTools,
    });

    const llmMessages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentMessages.filter((item) => item.role !== 'system'),
    ];

    const toolDefs = this.registry
      .getAvailableTools(agentConfig.enabledTools)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: this.toJsonSchema(tool.schema),
      }));

    const executedTools: ExecutedTool[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let steps = 0;
    let finalContent = '';
    let success = true;
    let error: string | undefined;
    let usedProvider = llmTarget.providerName;
    let usedModel = llmTarget.model;

    const execution = await this.prisma.agentExecution.create({
      data: {
        businessId: business.id,
        conversationId: conversation.id,
        provider: usedProvider,
        model: usedModel,
        durationMs: 0,
        steps: 0,
        success: false,
      },
    });

    try {
      while (steps < agentConfig.maxSteps) {
        steps += 1;
        const response = await this.chatWithFallback(llmTarget, {
          model: llmTarget.model,
          temperature: agentConfig.temperature,
          maxTokens: agentConfig.maxTokens,
          messages: llmMessages,
          tools: toolDefs.length ? toolDefs : undefined,
        }).then((result) => {
          llmTarget = result.target;
          usedProvider = result.target.providerName;
          usedModel = result.target.model;
          return result.response;
        });

        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;

        if (response.toolCalls.length) {
          llmMessages.push({
            role: 'assistant',
            content: response.content ?? '',
            toolCalls: response.toolCalls,
          });

          for (const call of response.toolCalls) {
            let parsedArgs: unknown = {};
            try {
              parsedArgs = JSON.parse(call.arguments || '{}');
            } catch {
              parsedArgs = {};
            }

            const result = await this.tools.execute(call.name, parsedArgs, {
              businessId: business.id,
              conversationId: conversation.id,
              userId: conversation.userId ?? undefined,
              channel: conversation.channel,
              enabledTools: agentConfig.enabledTools,
              agentExecutionId: execution.id,
              metadata: {
                ...input.metadata,
                confirmed: input.confirmed === true,
              },
            });

            executedTools.push({
              call,
              result,
              success: result.success,
              durationMs: result.durationMs,
              error: result.error,
              step: steps,
            });

            llmMessages.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify(result),
            });
          }
          continue;
        }

        finalContent = response.content?.trim() || 'No pude generar una respuesta.';
        break;
      }

      if (!finalContent) {
        finalContent =
          'Alcancé el límite de pasos del agente. Reformulá la consulta o revisá las herramientas.';
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : 'Agent execution failed';
      this.logger.error(
        `Agent run failed (${usedProvider}/${usedModel}): ${error}`,
      );
      finalContent =
        'Ocurrió un error al procesar el mensaje. Intentá nuevamente.';
    }

    const durationMs = Date.now() - started;
    const estimatedCost = this.cost.estimate(usedModel, inputTokens, outputTokens);

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        businessId: business.id,
        role: 'assistant',
        sender: 'AI',
        content: finalContent,
        model: usedModel,
        inputTokens,
        outputTokens,
        latencyMs: durationMs,
        status: 'sent',
        toolCalls: executedTools.length
          ? (executedTools as unknown as object)
          : undefined,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: finalContent.slice(0, 280),
        lastMessageSender: 'AI',
      },
    });

    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        provider: usedProvider,
        model: usedModel,
        inputTokens,
        outputTokens,
        estimatedCost,
        durationMs,
        steps,
        success,
        error,
      },
    });

    await this.costControl.incrementUsage(
      business.id,
      inputTokens + outputTokens,
    );

    const updated = await this.prisma.conversation.findFirst({
      where: { id: conversation.id, businessId: business.id },
    });

    const debug: AgentDebugInfo = {
      executionId: execution.id,
      steps,
      tools: executedTools.map((item) => ({
        name: item.call.name,
        input: this.safeParse(item.call.arguments),
        output: item.result,
        success: item.success,
        durationMs: item.durationMs,
        error: item.error,
        step: item.step,
      })),
      ragChunks,
      inputTokens,
      outputTokens,
      latencyMs: durationMs,
      estimatedCost,
      model: usedModel,
      provider: usedProvider,
      systemPrompt: input.debug ? systemPrompt : undefined,
      success,
      error,
    };

    return {
      conversationId: conversation.id,
      message: finalContent,
      status: (updated?.status ?? 'AI') as ConversationStatus,
      debug: input.debug ? debug : undefined,
    };
  }

  private async chatWithFallback(
    target: ReturnType<LlmRoutingService['resolvePrimary']>,
    request: ChatRequest,
  ): Promise<{
    response: ChatResponse;
    target: ReturnType<LlmRoutingService['resolvePrimary']>;
  }> {
    try {
      const response = await target.provider.chat({
        ...request,
        model: target.model,
      });
      return { response, target };
    } catch (error) {
      const fallback = this.llmRouting.resolveFallback(target.providerName);
      if (
        !fallback ||
        !this.llmRouting.isRetryableLlmError(error)
      ) {
        throw error;
      }

      this.logger.warn(
        `LLM ${target.providerName}/${target.model} falló (${
          error instanceof Error ? error.message : 'unknown'
        }). Fallback → ${fallback.providerName}/${fallback.model}`,
      );

      const response = await fallback.provider.chat({
        ...request,
        model: fallback.model,
      });
      return { response, target: fallback };
    }
  }

  private async resolveAgentConfig(businessId: string, agentConfigId?: string) {
    if (agentConfigId) {
      const config = await this.prisma.agentConfig.findFirst({
        where: { id: agentConfigId, businessId },
      });
      if (!config) {
        throw new HttpException('Agent config not found', HttpStatus.NOT_FOUND);
      }
      return config;
    }

    const fallback = await this.prisma.agentConfig.findFirst({
      where: { businessId, isDefault: true },
    });
    if (!fallback) {
      throw new HttpException(
        'No default agent configured for this business',
        HttpStatus.FAILED_DEPENDENCY,
      );
    }
    return fallback;
  }

  private async resolveConversation(
    input: AgentRunInput,
    agentConfigId: string,
  ) {
    if (input.conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: input.conversationId, businessId: input.businessId },
      });
      if (!existing) {
        throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: {
        businessId: input.businessId,
        agentConfigId,
        userId: input.userId,
        channel: (input.channel ?? 'WEB').toUpperCase(),
        status: 'AI',
        metadata: input.metadata as object | undefined,
      },
    });
  }

  private toJsonSchema(schema: unknown): Record<string, unknown> {
    try {
      const json = zodToJsonSchema(schema as never, {
        target: 'openApi3',
        $refStrategy: 'none',
      }) as Record<string, unknown>;
      delete json.$schema;
      return this.sanitizeJsonSchemaForLlm(json) as Record<string, unknown>;
    } catch {
      return { type: 'object', additionalProperties: true };
    }
  }

  /**
   * Gemini (y otros providers) rechazan JSON Schema draft-04 donde
   * exclusiveMinimum/exclusiveMaximum son booleanos.
   */
  private sanitizeJsonSchemaForLlm(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeJsonSchemaForLlm(item));
    }
    if (!value || typeof value !== 'object') return value;

    const node = { ...(value as Record<string, unknown>) };

    if (node.exclusiveMinimum === true) {
      if (typeof node.minimum === 'number') {
        node.exclusiveMinimum = node.minimum;
        delete node.minimum;
      } else {
        delete node.exclusiveMinimum;
      }
    } else if (node.exclusiveMinimum === false) {
      delete node.exclusiveMinimum;
    }

    if (node.exclusiveMaximum === true) {
      if (typeof node.maximum === 'number') {
        node.exclusiveMaximum = node.maximum;
        delete node.maximum;
      } else {
        delete node.exclusiveMaximum;
      }
    } else if (node.exclusiveMaximum === false) {
      delete node.exclusiveMaximum;
    }

    for (const [key, child] of Object.entries(node)) {
      if (child && typeof child === 'object') {
        node[key] = this.sanitizeJsonSchemaForLlm(child);
      }
    }
    return node;
  }

  private safeParse(value: string): unknown {
    try {
      return JSON.parse(value || '{}');
    } catch {
      return value;
    }
  }

  private parseConfiguredMessages(raw: unknown): ConfiguredMessagesPrompt {
    const base = { ...DEFAULT_CONFIGURED_MESSAGES };
    if (!raw || typeof raw !== 'object') return base;
    return { ...base, ...(raw as ConfiguredMessagesPrompt) };
  }
}
