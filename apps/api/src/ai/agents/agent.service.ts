import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { LeadContextService } from '../../leads/lead-context.service';
import { LeadsService } from '../../leads/leads.service';

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
    private readonly leadContext: LeadContextService,
    private readonly leads: LeadsService,
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const started = Date.now();
    const message = this.guardrails.sanitizeUserInput(input.message);
    if (!message) {
      throw new HttpException('Message is required', HttpStatus.BAD_REQUEST);
    }
    this.logger.log(`[AGENT 1/6] start channel=${input.channel} businessId=${input.businessId} len=${message.length} conv=${input.conversationId ?? 'new'}`);
    const t1 = Date.now();
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
    this.logger.log(`[AGENT 1/6] business+agent ${Date.now() - t1}ms model=${agentConfig.model} provider=${llmTarget.providerName}`);

    const t2 = Date.now();
    const conversation = await this.resolveConversation(input, agentConfig.id);
    const confirmed = await this.resolveConfirmed(input, conversation.id);
    this.logger.log(`[AGENT 2/6] conversation ${Date.now() - t2}ms conv=${conversation.id} status=${conversation.status} confirmed=${confirmed}`);

    const inboundExternalId = input.metadata?.wamid
      ? String(input.metadata.wamid)
      : input.metadata?.externalMessageId
        ? String(input.metadata.externalMessageId)
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
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
          },
        });
      }
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessagePreview: message.slice(0, 280),
          lastMessageSender: 'CLIENT',
          ...(alreadyPersisted
            ? {}
            : {
                lastMessageAt: new Date(),
                unreadCount: { increment: 1 },
              }),
          contactName: input.metadata?.contactName
            ? String(input.metadata.contactName)
            : undefined,
          contactPhone: input.metadata?.contactPhone
            ? String(input.metadata.contactPhone)
            : undefined,
          contactUsername: input.metadata?.contactUsername
            ? String(input.metadata.contactUsername)
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
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
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
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    }
    const t3 = Date.now();
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessagePreview: message.slice(0, 280),
        lastMessageSender: 'CLIENT',
        ...(alreadyPersisted
          ? {}
          : {
              lastMessageAt: new Date(),
              unreadCount: { increment: 1 },
            }),
      },
    });
    await this.leads.recordInbound(business.id, conversation.id);
    this.logger.log(`[AGENT 3/6] persist inbound ${Date.now() - t3}ms`);

    const t4 = Date.now();
    const strategy = this.memory.parseStrategy(agentConfig.memoryStrategy);
    const tMem = Date.now();
    const recentMessages = await this.memory.getRecentMessages(
      conversation.id,
      business.id,
      strategy.recentMessages,
    );
    this.logger.log(`[AGENT 4/6a] memory.recent ${Date.now() - tMem}ms count=${recentMessages.length}`);

    // Paralelizar longTerm (embeddings OpenAI), RAG y hours/services — antes eran secuenciales y sumaban ~2s
    const tParallel = Date.now();
    const longTermPromise = (async () => {
      const s = Date.now();
      const r = await this.memory.getLongTermContext({
        businessId: business.id,
        query: message,
        userId: conversation.userId ?? undefined,
        topK: strategy.semanticTopK,
      });
      this.logger.log(`[AGENT 4/6b] memory.longTerm ${Date.now() - s}ms`);
      return r;
    })();
    const ragPromise = (async () => {
      const s = Date.now();
      if (!agentConfig.knowledgeBaseId) {
        this.logger.log(`[AGENT 4/6c] rag.search 0ms chunks=0 kb=none (skip)`);
        return [] as Awaited<ReturnType<RagService['search']>>;
      }
      const r = await this.rag.search({
        businessId: business.id,
        query: message,
        knowledgeBaseId: agentConfig.knowledgeBaseId,
        topK: 8,
      });
      this.logger.log(`[AGENT 4/6c] rag.search ${Date.now() - s}ms chunks=${r.length} kb=${agentConfig.knowledgeBaseId}`);
      return r;
    })();
    const hoursServicesPromise = (async () => {
      const s = Date.now();
      const res = await Promise.all([
        this.prisma.businessHour.findMany({
          where: { businessId: business.id },
          orderBy: { dayOfWeek: 'asc' },
        }),
        this.prisma.service.findMany({
          where: { businessId: business.id, enabled: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
      ]);
      this.logger.log(`[AGENT 4/6d] hours+services ${Date.now() - s}ms hours=${res[0].length} services=${res[1].length}`);
      return res;
    })();

    const [longTerm, ragChunks, [hours, services]] = await Promise.all([
      longTermPromise,
      ragPromise,
      hoursServicesPromise,
    ]);
    this.logger.log(`[AGENT 4/6] total pre-prompt ${Date.now() - t4}ms parallel=${Date.now() - tParallel}ms`);

    const configuredMessages = this.parseConfiguredMessages(
      business.defaultMessages,
    );

    const tPrompt = Date.now();
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
        googleReviewsUrl: business.googleReviewsUrl,
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
      leadContext:
        (
          await this.leadContext.snapshot(business.id, conversation.id)
        )?.text ?? null,
    });
    this.logger.log(`[AGENT 5/6] prompt.build ${Date.now() - tPrompt}ms system=${systemPrompt.length} chars llmMessages=${1 + recentMessages.length}`);

    const llmMessages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentMessages.filter((item) => item.role !== 'system'),
    ];
    this.logger.log(`[AGENT 5/6] llmMessages ready totalPrompt=${systemPrompt.length + recentMessages.reduce((a, m) => a + (m.content?.length ?? 0), 0)} chars tools=${agentConfig.enabledTools.length}`);

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

    const seenSuccessfulToolCalls = new Set<string>();
    let forceFinalAnswer = false;
    const tLlmLoop = Date.now();
    this.logger.log(`[AGENT 6/6] llm loop start maxSteps=${agentConfig.maxSteps} model=${llmTarget.model} temp=${agentConfig.temperature}`);

    try {
      while (steps < agentConfig.maxSteps) {
        steps += 1;
        const tStep = Date.now();
        const response = await this.chatWithFallback(llmTarget, {
          model: llmTarget.model,
          temperature: agentConfig.temperature,
          maxTokens: agentConfig.maxTokens,
          messages: llmMessages,
          tools: forceFinalAnswer || !toolDefs.length ? undefined : toolDefs,
        }).then((result) => {
          llmTarget = result.target;
          usedProvider = result.target.providerName;
          usedModel = result.target.model;
          return result.response;
        });
        this.logger.log(`[AGENT 6/6] step ${steps} llm.chat ${Date.now() - tStep}ms provider=${usedProvider} in=${response.usage.inputTokens} out=${response.usage.outputTokens} toolCalls=${response.toolCalls.length} finish=${response.finishReason}`);

        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;

        if (!forceFinalAnswer && response.toolCalls.length) {
          llmMessages.push({
            role: 'assistant',
            content: response.content ?? '',
            toolCalls: response.toolCalls,
          });

          let repeatedSuccessfulCall = false;

          for (const call of response.toolCalls) {
            let parsedArgs: unknown = {};
            try {
              parsedArgs = JSON.parse(call.arguments || '{}');
            } catch {
              parsedArgs = {};
            }

            const fingerprint = this.toolCallFingerprint(call.name, parsedArgs);
            const alreadySucceeded = seenSuccessfulToolCalls.has(fingerprint);

            if (alreadySucceeded) {
              repeatedSuccessfulCall = true;
              const result = {
                success: true,
                error:
                  'Ya ejecutaste esta herramienta con los mismos argumentos. Respondé ahora al usuario con la información ya obtenida; no vuelvas a llamar tools.',
                data: { repeated: true, tool: call.name },
                durationMs: 0,
              };
              executedTools.push({
                call,
                result,
                success: true,
                durationMs: 0,
                error: result.error,
                step: steps,
              });
              llmMessages.push({
                role: 'tool',
                toolCallId: call.id,
                name: call.name,
                content: JSON.stringify(result),
              });
              continue;
            }

            const tTool = Date.now();
            let result = await this.tools.execute(call.name, parsedArgs, {
              businessId: business.id,
              conversationId: conversation.id,
              userId: conversation.userId ?? undefined,
              channel: conversation.channel,
              enabledTools: agentConfig.enabledTools,
              agentExecutionId: execution.id,
              metadata: {
                ...input.metadata,
                confirmed,
              },
            });
            this.logger.log(`[AGENT 6/6] tool ${call.name} ${Date.now() - tTool}ms success=${result.success}`);

            // sendEmail / sendWhatsAppMessage: no hay UI de confirmación en chat.
            if (
              !result.success &&
              result.requiresConfirmation &&
              !confirmed &&
              (call.name === 'sendEmail' || call.name === 'sendWhatsAppMessage')
            ) {
              result = await this.tools.execute(call.name, parsedArgs, {
                businessId: business.id,
                conversationId: conversation.id,
                userId: conversation.userId ?? undefined,
                channel: conversation.channel,
                enabledTools: agentConfig.enabledTools,
                agentExecutionId: execution.id,
                metadata: {
                  ...input.metadata,
                  confirmed: true,
                },
              });
            }

            if (result.success) {
              seenSuccessfulToolCalls.add(fingerprint);
            }

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

          if (repeatedSuccessfulCall) {
            forceFinalAnswer = true;
          }
          this.logger.log(`[AGENT 6/6] step ${steps} tools done ${Date.now() - tStep}ms`);
          continue;
        }

        finalContent =
          response.content?.trim() ||
          this.fallbackFromToolResults(executedTools) ||
          'No pude generar una respuesta.';
        this.logger.log(`[AGENT 6/6] loop exit after ${steps} steps total ${Date.now() - tLlmLoop}ms finalLen=${finalContent.length}`);
        break;
      }

      if (!finalContent && executedTools.length) {
        // Último intento: responder sin tools (p.ej. Gemini lite se queda en loop).
        const synthesis = await this.chatWithFallback(llmTarget, {
          model: llmTarget.model,
          temperature: agentConfig.temperature,
          maxTokens: agentConfig.maxTokens,
          messages: [
            ...llmMessages,
            {
              role: 'user',
              content:
                'Con la información de las herramientas anteriores, respondé ahora al usuario de forma clara y breve. No llames más herramientas.',
            },
          ],
        }).then((result) => {
          llmTarget = result.target;
          usedProvider = result.target.providerName;
          usedModel = result.target.model;
          return result.response;
        });
        steps += 1;
        inputTokens += synthesis.usage.inputTokens;
        outputTokens += synthesis.usage.outputTokens;
        finalContent =
          synthesis.content?.trim() ||
          this.fallbackFromToolResults(executedTools) ||
          '';
      }

      if (!finalContent) {
        finalContent =
          this.fallbackFromToolResults(executedTools) ||
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
    const estimatedCost = this.cost.estimate(
      usedModel,
      inputTokens,
      outputTokens,
    );

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
      if (!fallback || !this.llmRouting.isRetryableLlmError(error)) {
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

    const channel = (input.channel ?? 'WEB').toUpperCase();
    const metadata = {
      ...(input.metadata ?? {}),
      ...(channel === 'PLAYGROUND' ? { source: 'playground' } : {}),
    };

    return this.prisma.conversation.create({
      data: {
        businessId: input.businessId,
        agentConfigId,
        userId: input.userId,
        channel,
        status: 'AI',
        metadata: metadata,
      },
    });
  }

  /**
   * WhatsApp/web no mandan `confirmed: true` estructurado: el usuario solo escribe "sí".
   * Si la última tool falló pidiendo confirmación, el próximo mensaje afirmativo la libera.
   */
  private async resolveConfirmed(
    input: AgentRunInput,
    conversationId: string,
  ): Promise<boolean> {
    if (input.confirmed === true) return true;

    const recent = await this.prisma.toolExecution.findFirst({
      where: {
        conversationId,
        businessId: input.businessId,
        success: false,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!recent) return false;

    const output =
      recent.output && typeof recent.output === 'object'
        ? (recent.output as { requiresConfirmation?: boolean })
        : null;
    if (!output?.requiresConfirmation) return false;

    return this.looksLikeAffirmation(input.message);
  }

  private looksLikeAffirmation(message: string): boolean {
    const normalized = message
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim();
    if (!normalized) return false;

    const patterns = [
      /^si\b/,
      /^sí\b/,
      /\bsi[,.]?\s*(autorizo|confirmo|dale|envio|envia|envialo|envíalo)\b/,
      /\bautorizo\b/,
      /\bconfirmo\b/,
      /\bde acuerdo\b/,
      /\bdale\b/,
      /\bok\b/,
      /\bokay\b/,
      /\bprocede\b/,
      /\benvia(lo|me)?\b/,
      /\benvíalo\b/,
      /\benviá(lo|me)?\b/,
    ];
    return patterns.some((re) => re.test(normalized));
  }

  private toolCallFingerprint(name: string, args: unknown): string {
    return `${name}:${JSON.stringify(args ?? {})}`;
  }

  private fallbackFromToolResults(
    executedTools: ExecutedTool[],
  ): string | null {
    for (let i = executedTools.length - 1; i >= 0; i -= 1) {
      const item = executedTools[i];
      if (item.call.name !== 'checkAvailability' || !item.success) continue;
      const payload =
        item.result && typeof item.result === 'object'
          ? (item.result as { data?: Record<string, unknown> }).data
          : undefined;
      if (!payload || typeof payload !== 'object') continue;

      const date = typeof payload.date === 'string' ? payload.date : null;
      const dayLabel =
        typeof payload.dayLabel === 'string' ? payload.dayLabel : null;
      const slots = Array.isArray(payload.slots) ? payload.slots : [];
      const label = dayLabel || date || 'ese día';

      if (!slots.length) {
        return `Para ${label} no tengo turnos libres en este momento. ¿Querés que revise otra fecha?`;
      }

      const options = slots
        .slice(0, 4)
        .map((slot) => {
          if (!slot || typeof slot !== 'object') return null;
          const start = (slot as { start?: string }).start;
          return typeof start === 'string' ? start : null;
        })
        .filter((value): value is string => Boolean(value));

      if (!options.length) {
        return `Encontré disponibilidad para ${label}. Decime qué horario te viene bien.`;
      }

      return `Para ${label} tengo estos horarios libres: ${options.join(', ')}. ¿Cuál te sirve?`;
    }
    return null;
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
