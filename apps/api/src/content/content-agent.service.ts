import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import OpenAI from 'openai';
import { PrismaService } from '../common/prisma/prisma.service';
import { LlmRoutingService } from '../ai/providers/llm-routing.service';
import type { LlmMessage } from '../ai/providers/llm-provider.interface';
import { CostService } from '../analytics/cost.service';
import type {
  ContentChannel,
  ContentObjective,
  ContentStrategy,
} from './content.types';

const strategySchema = z.object({
  topic: z.string().min(2).max(200),
  objective: z.enum([
    'AUTOMATIC',
    'SERVICE_PROMOTION',
    'OFFER',
    'TIP',
    'INFO',
    'SPECIAL_DATE',
    'CUSTOM',
  ]),
  headline: z.string().min(2).max(160),
  caption: z.string().min(2).max(2200),
  cta: z.string().min(2).max(120),
  imagePrompt: z.string().min(10).max(2500),
  visualStyle: z.string().min(2).max(400),
  serviceId: z.string().uuid().nullable().optional(),
  audience: z.string().max(300).nullable().optional(),
});

export interface ContentAgentInput {
  businessId: string;
  objective: ContentObjective;
  channels: ContentChannel[];
  userInstructions?: string;
  serviceId?: string;
  referenceImageUrls?: string[];
}

export interface ContentAgentResult {
  strategy: ContentStrategy;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  durationMs: number;
}

@Injectable()
export class ContentAgentService {
  private readonly logger = new Logger(ContentAgentService.name);
  private readonly openai: OpenAI | null;
  private readonly visionModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmRouting: LlmRoutingService,
    private readonly cost: CostService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY') || '';
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    this.visionModel =
      this.config.get<string>('CONTENT_VISION_MODEL') ||
      this.config.get<string>('OPENAI_DEFAULT_MODEL') ||
      'gpt-4.1-mini';
  }

  async buildStrategy(input: ContentAgentInput): Promise<ContentAgentResult> {
    const started = Date.now();
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: input.businessId },
      include: {
        brandingConfig: true,
        socialContentConfig: true,
        businessHours: { orderBy: { dayOfWeek: 'asc' } },
        services: {
          where: { enabled: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          take: 30,
        },
        agentConfigs: { where: { isDefault: true }, take: 1 },
      },
    });

    const recent = await this.prisma.generatedContent.findMany({
      where: {
        businessId: input.businessId,
        status: { not: 'FAILED' },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        topic: true,
        headline: true,
        cta: true,
        objective: true,
        serviceId: true,
        visualStyle: true,
        createdAt: true,
      },
    });

    const selectedService = input.serviceId
      ? (business.services.find((s) => s.id === input.serviceId) ?? null)
      : null;

    const system = this.buildSystemPrompt();
    const userText = this.buildUserPrompt({
      business,
      selectedService,
      objective: input.objective,
      channels: input.channels,
      userInstructions: input.userInstructions,
      recent,
      referenceImageCount: input.referenceImageUrls?.length ?? 0,
    });

    const referenceImageUrls = (input.referenceImageUrls ?? [])
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 4);

    let providerName: string;
    let model: string;
    let content: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (referenceImageUrls.length > 0) {
      if (!this.openai) {
        throw new Error(
          'OPENAI_API_KEY requerida para usar imágenes de referencia en el Content Agent',
        );
      }
      providerName = 'openai';
      model = this.visionModel;
      const completion = await this.openai.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              ...referenceImageUrls.map((url) => ({
                type: 'image_url' as const,
                image_url: { url, detail: 'high' as const },
              })),
            ],
          },
        ],
      });
      content = completion.choices[0]?.message?.content ?? '';
      inputTokens = completion.usage?.prompt_tokens ?? 0;
      outputTokens = completion.usage?.completion_tokens ?? 0;
    } else {
      const agentConfig = business.agentConfigs[0];
      const target = this.llmRouting.resolvePrimary(
        agentConfig
          ? {
              provider: agentConfig.provider,
              model: agentConfig.model,
            }
          : {
              provider: 'openai',
              model: 'gpt-4.1-mini',
            },
      );

      const messages: LlmMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ];

      let used = target;
      let response;
      try {
        response = await used.provider.chat({
          model: used.model,
          temperature: 0.7,
          maxTokens: 1200,
          messages,
        });
      } catch (error) {
        const fallback = this.llmRouting.resolveFallback(used.providerName);
        if (!fallback || !this.llmRouting.isRetryableLlmError(error)) throw error;
        this.logger.warn(
          `Content LLM fallback ${used.providerName} → ${fallback.providerName}`,
        );
        used = fallback;
        response = await used.provider.chat({
          model: used.model,
          temperature: 0.7,
          maxTokens: 1200,
          messages,
        });
      }

      providerName = used.providerName;
      model = used.model;
      content = response.content ?? '';
      inputTokens = response.usage.inputTokens ?? 0;
      outputTokens = response.usage.outputTokens ?? 0;
    }

    const parsed = this.parseStrategyJson(content);
    const strategy = strategySchema.parse({
      ...parsed,
      objective:
        input.objective === 'AUTOMATIC' ? parsed.objective : input.objective,
      serviceId: input.serviceId ?? parsed.serviceId ?? null,
    });

    return {
      strategy,
      provider: providerName,
      model,
      inputTokens,
      outputTokens,
      estimatedCost: this.cost.estimate(model, inputTokens, outputTokens),
      durationMs: Date.now() - started,
    };
  }

  private parseStrategyJson(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1]?.trim() ?? trimmed;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('El Content Agent no devolvió JSON válido');
    }
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  }

  private buildSystemPrompt(): string {
    return `Sos un Content Agent de marketing para un negocio local.
Tu trabajo es crear UNA estrategia de publicación en JSON (sin markdown extra).
Reglas:
- Caption en español, natural, sin hashtags excesivos (máx 5).
- Evitá repetir temas/headlines/CTA de RECENT CONTENT.
- imagePrompt en inglés, fotográfico/publicitario, sin texto ilegible en la imagen.
- Si hay branding, respetá colores, estilo, audiencia y "evitar".
- Si hay REFERENCE IMAGES, usalas como contexto visual: producto, local, estilo, personas o detalles a preservar. El imagePrompt debe describir cómo combinarlas en una pieza nueva (no copiar textual).
- CTA claro y accionable.
- Respondé SOLO con un objeto JSON con las keys:
  topic, objective, headline, caption, cta, imagePrompt, visualStyle, serviceId, audience`;
  }

  private buildUserPrompt(params: {
    business: {
      name: string;
      description: string | null;
      type: string;
      timezone: string;
      brandingConfig: {
        primaryColor: string | null;
        secondaryColor: string | null;
        visualStyle: string | null;
        commercialTone: string | null;
        targetAudience: string | null;
        preferNotes: string | null;
        avoidNotes: string | null;
        additionalInstructions: string | null;
      } | null;
      services: Array<{
        id: string;
        name: string;
        description: string | null;
        durationMinutes: number;
        price: { toString(): string } | null;
      }>;
      businessHours: Array<{
        dayOfWeek: number;
        isClosed: boolean;
        ranges: unknown;
      }>;
    };
    selectedService: {
      id: string;
      name: string;
      description: string | null;
    } | null;
    objective: ContentObjective;
    channels: ContentChannel[];
    userInstructions?: string;
    referenceImageCount: number;
    recent: Array<{
      topic: string | null;
      headline: string | null;
      cta: string | null;
      objective: string;
      serviceId: string | null;
      visualStyle: string | null;
    }>;
  }): string {
    const days = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ];
    const hours = params.business.businessHours
      .map((h) => {
        const label = days[h.dayOfWeek] ?? `Día ${h.dayOfWeek}`;
        if (h.isClosed) return `${label}: Cerrado`;
        const ranges = Array.isArray(h.ranges)
          ? (h.ranges as Array<{ start: string; end: string }>)
          : [];
        return `${label}: ${ranges.map((r) => `${r.start}-${r.end}`).join(', ') || 'Cerrado'}`;
      })
      .join('\n');

    const services = params.business.services
      .map(
        (s) =>
          `- ${s.id} | ${s.name}${s.description ? `: ${s.description}` : ''} (${s.durationMinutes} min${s.price ? `, $${s.price}` : ''})`,
      )
      .join('\n');

    const brand = params.business.brandingConfig;
    const brandBlock = brand
      ? [
          `Estilo visual: ${brand.visualStyle || '—'}`,
          `Tono comercial: ${brand.commercialTone || '—'}`,
          `Audiencia: ${brand.targetAudience || '—'}`,
          `Colores: ${brand.primaryColor || '—'} / ${brand.secondaryColor || '—'}`,
          `Preferir: ${brand.preferNotes || '—'}`,
          `Evitar: ${brand.avoidNotes || '—'}`,
          `Extra: ${brand.additionalInstructions || '—'}`,
        ].join('\n')
      : 'Sin branding configurado.';

    const recentBlock =
      params.recent
        .map(
          (r) =>
            `- ${r.objective} | ${r.topic || '—'} | ${r.headline || '—'} | CTA: ${r.cta || '—'}`,
        )
        .join('\n') || 'Sin publicaciones previas.';

    const formatHint = params.channels.some(
      (c) => c === 'INSTAGRAM_STORY' || c === 'WHATSAPP_STATUS',
    )
      ? 'Priorizar composición vertical 9:16 (story/status).'
      : 'Priorizar composición cuadrada/feed.';

    return [
      'BUSINESS',
      `Nombre: ${params.business.name}`,
      `Rubro: ${params.business.type}`,
      `Descripción: ${params.business.description || '—'}`,
      '',
      'SERVICES',
      services || '—',
      '',
      'HOURS',
      hours || '—',
      '',
      'BRAND',
      brandBlock,
      '',
      'RECENT CONTENT (evitar repetir)',
      recentBlock,
      '',
      'USER REQUEST',
      `Objective: ${params.objective}`,
      `Channels: ${params.channels.join(', ')}`,
      `Selected service: ${
        params.selectedService
          ? `${params.selectedService.name} (${params.selectedService.id})`
          : 'ninguno'
      }`,
      `Instructions: ${params.userInstructions?.trim() || '—'}`,
      `Format hint: ${formatHint}`,
      `Reference images attached: ${params.referenceImageCount}`,
      params.referenceImageCount > 0
        ? 'Las imágenes adjuntas son contexto visual obligatorio para caption e imagePrompt.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
