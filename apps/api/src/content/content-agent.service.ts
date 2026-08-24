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
  ContentMediaType,
  ContentObjective,
  ContentStrategy,
  ContentStyle,
} from './content.types';
import { CONTENT_STYLE_LABEL } from './content.types';
import { normalizeHashtags } from './video-editor/text-overlay';
import {
  buildBriefSystemPrompt,
  buildBriefUserPrompt,
  sanitizeBrief,
} from './suggest-brief';
import {
  restoreQuotedSpanish,
  restoreSpanishOrthography,
  SPANISH_ORTHOGRAPHY_RULE,
} from './spanish-orthography';
import { ContentKnowledgeService } from './content-knowledge.service';

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
  hook: z.string().max(160).nullish(),
  hashtags: z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        return value.split(/[\s,]+/).filter(Boolean);
      }
      return value;
    },
    z.array(z.string().max(40)).max(5).optional(),
  ),
  imagePrompt: z.string().min(10).max(2500),
  videoPrompt: z.string().min(10).max(2500).optional(),
  visualStyle: z.string().min(2).max(400),
  serviceId: z.string().uuid().nullable().optional(),
  audience: z.string().max(300).nullable().optional(),
  contentStyle: z.enum(['EDUCATIONAL', 'COMEDY', 'SALES']).nullable().optional(),
  editing: z
    .object({
      add_hook: z.boolean().optional(),
      hook_start: z.number().optional(),
      hook_end: z.number().optional(),
      hook_position: z.enum(['top', 'center', 'bottom']).optional(),
      hook_font_size: z.number().optional(),
      add_cta: z.boolean().optional(),
      cta_start: z.number().optional(),
      cta_end: z.number().optional(),
      cta_position: z.enum(['top', 'center', 'bottom']).optional(),
      cta_font_size: z.number().optional(),
      add_logo: z.boolean().optional(),
      logo_position: z
        .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
        .optional(),
      logo_width: z.number().optional(),
      logo_opacity: z.number().optional(),
    })
    .optional()
    .catch(undefined),
});

export interface ContentAgentInput {
  businessId: string;
  objective: ContentObjective;
  channels: ContentChannel[];
  userInstructions?: string;
  serviceId?: string;
  referenceImageUrls?: string[];
  mediaType?: ContentMediaType;
  durationSeconds?: number;
  contentStyle?: ContentStyle;
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

export interface ContentBriefResult {
  instructions: string;
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
    private readonly contentKnowledge: ContentKnowledgeService,
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

    const system = this.buildSystemPrompt(
      input.mediaType ?? 'IMAGE',
      input.durationSeconds ?? 5,
    );
    const logoUrl = business.brandingConfig?.logoUrl?.trim() || null;
    const contentGuidelines = await this.contentKnowledge.getPromptContext(
      input.businessId,
    );
    const contentStyle = input.contentStyle ?? 'AUTO';
    const userText = this.buildUserPrompt({
      business,
      selectedService,
      objective: input.objective,
      channels: input.channels,
      userInstructions: input.userInstructions,
      recent,
      referenceImageCount: input.referenceImageUrls?.length ?? 0,
      mediaType: input.mediaType ?? 'IMAGE',
      durationSeconds: input.durationSeconds ?? 5,
      contentStyle,
      contentGuidelines,
    });

    const referenceImageUrls = this.mergeLogoAndRefs(
      logoUrl,
      input.referenceImageUrls,
    );

    let providerName: string;
    let model: string;
    let content: string;
    let inputTokens: number;
    let outputTokens: number;

    if (referenceImageUrls.length > 0) {
      if (!this.openai) {
        throw new Error(
          'OPENAI_API_KEY requerida para usar imágenes de referencia en el Content Agent',
        );
      }
      providerName = 'openai';
      model = this.visionModel;
      const usesMaxCompletionTokens =
        model.toLowerCase().startsWith('gpt-5') ||
        model.toLowerCase().startsWith('o1') ||
        model.toLowerCase().startsWith('o3') ||
        model.toLowerCase().startsWith('o4');
      const completion = await this.openai.chat.completions.create({
        model,
        ...(usesMaxCompletionTokens ? {} : { temperature: 0.7 }),
        ...(usesMaxCompletionTokens
          ? { max_completion_tokens: 1600 }
          : { max_tokens: 1600 }),
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
          maxTokens: 1600,
          messages,
        });
      } catch (error) {
        const fallback = this.llmRouting.resolveFallback(used.providerName);
        if (!fallback || !this.llmRouting.isRetryableLlmError(error))
          throw error;
        this.logger.warn(
          `Content LLM fallback ${used.providerName} → ${fallback.providerName}`,
        );
        used = fallback;
        response = await used.provider.chat({
          model: used.model,
          temperature: 0.7,
          maxTokens: 1600,
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
    const mediaType = input.mediaType ?? 'IMAGE';
    const strategy = strategySchema.parse({
      ...parsed,
      objective:
        input.objective === 'AUTOMATIC' ? parsed.objective : input.objective,
      serviceId: input.serviceId ?? parsed.serviceId ?? null,
      contentStyle:
        contentStyle === 'AUTO'
          ? parsed.contentStyle ?? null
          : contentStyle === 'EDUCATIONAL' ||
              contentStyle === 'COMEDY' ||
              contentStyle === 'SALES'
            ? contentStyle
            : parsed.contentStyle ?? null,
      videoPrompt:
        mediaType === 'VIDEO'
          ? parsed.videoPrompt || parsed.imagePrompt
          : parsed.videoPrompt,
    });

    return {
      strategy: {
        ...strategy,
        topic: restoreSpanishOrthography(strategy.topic),
        headline: restoreSpanishOrthography(strategy.headline),
        caption: restoreSpanishOrthography(strategy.caption),
        cta: restoreSpanishOrthography(strategy.cta),
        hook: strategy.hook
          ? restoreSpanishOrthography(strategy.hook)
          : undefined,
        videoPrompt: strategy.videoPrompt
          ? restoreQuotedSpanish(strategy.videoPrompt)
          : undefined,
        hashtags: normalizeHashtags(strategy.hashtags),
        contentStyle: strategy.contentStyle ?? null,
      },
      provider: providerName,
      model,
      inputTokens,
      outputTokens,
      estimatedCost: this.cost.estimate(model, inputTokens, outputTokens),
      durationMs: Date.now() - started,
    };
  }

  async suggestBrief(input: {
    businessId: string;
    objective: ContentObjective;
    channels: ContentChannel[];
    mediaType: ContentMediaType;
    durationSeconds?: number;
    serviceId?: string;
    hint?: string;
    contentStyle?: ContentStyle;
  }): Promise<ContentBriefResult> {
    const started = Date.now();
    const durationSeconds = input.durationSeconds ?? 5;
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: input.businessId },
      include: {
        brandingConfig: true,
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
      take: 8,
      select: { topic: true, headline: true, cta: true, objective: true },
    });

    const selectedService = input.serviceId
      ? (business.services.find((s) => s.id === input.serviceId) ?? null)
      : null;

    const days = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ];
    const hours = business.businessHours
      .map((h) => {
        const label = days[h.dayOfWeek] ?? `Día ${h.dayOfWeek}`;
        if (h.isClosed) return `${label}: Cerrado`;
        const ranges = Array.isArray(h.ranges)
          ? (h.ranges as Array<{ start: string; end: string }>)
          : [];
        return `${label}: ${ranges.map((r) => `${r.start}-${r.end}`).join(', ') || 'Cerrado'}`;
      })
      .join('\n');
    const services = business.services
      .map(
        (s) =>
          `- ${s.name}${s.description ? `: ${s.description}` : ''}${
            s.price ? ` ($${s.price})` : ''
          }`,
      )
      .join('\n');
    const brand = business.brandingConfig;
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
      : 'Sin branding extra.';

    const contentStyle = input.contentStyle ?? 'AUTO';
    const contentGuidelines = await this.contentKnowledge.getPromptContext(
      input.businessId,
    );

    const system = buildBriefSystemPrompt({
      mediaType: input.mediaType,
      durationSeconds,
      objective: input.objective,
      contentStyle,
    });
    const userText = buildBriefUserPrompt({
      businessName: business.name,
      businessType: business.type,
      description: business.description,
      todayLabel: new Intl.DateTimeFormat('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date()),
      objective: input.objective,
      mediaType: input.mediaType,
      durationSeconds,
      channels: input.channels,
      selectedService: selectedService
        ? {
            name: selectedService.name,
            description: selectedService.description,
          }
        : null,
      services,
      hours,
      brand: brandBlock,
      recent:
        recent
          .map(
            (r) =>
              `- ${r.objective} | ${r.topic || '—'} | ${r.headline || '—'} | CTA: ${r.cta || '—'}`,
          )
          .join('\n') || '—',
      hint: input.hint,
      contentStyle,
      contentGuidelines,
    });

    const { providerName, model, content, inputTokens, outputTokens } =
      await this.completePlain(business.agentConfigs[0], system, userText, 700);

    const instructions = sanitizeBrief(content);
    if (!instructions) {
      throw new Error('La IA no devolvió un guion usable');
    }

    return {
      instructions,
      provider: providerName,
      model,
      inputTokens,
      outputTokens,
      estimatedCost: this.cost.estimate(model, inputTokens, outputTokens),
      durationMs: Date.now() - started,
    };
  }

  private async completePlain(
    agentConfig: { provider: string; model: string } | undefined,
    system: string,
    userText: string,
    maxTokens: number,
  ): Promise<{
    providerName: string;
    model: string;
    content: string;
    inputTokens: number;
    outputTokens: number;
  }> {
    const target = this.llmRouting.resolvePrimary(
      agentConfig
        ? { provider: agentConfig.provider, model: agentConfig.model }
        : { provider: 'openai', model: 'gpt-4.1-mini' },
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
        temperature: 0.85,
        maxTokens,
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
        temperature: 0.85,
        maxTokens,
        messages,
      });
    }
    return {
      providerName: used.providerName,
      model: used.model,
      content: response.content ?? '',
      inputTokens: response.usage.inputTokens ?? 0,
      outputTokens: response.usage.outputTokens ?? 0,
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

  private mergeLogoAndRefs(
    _logoUrl: string | null,
    refs: string[] | undefined,
  ): string[] {
    // Logo ya NO se envía como reference image — se aplica después vía BrandingRenderer (Sharp)
    // Mantener firma por compatibilidad, pero ignorar logoUrl
    const cleaned = [
      ...new Set((refs ?? []).map((u) => u.trim()).filter(Boolean)),
    ];
    return cleaned.slice(0, 4);
  }

  private buildSystemPrompt(
    mediaType: ContentMediaType,
    durationSeconds = 5,
  ): string {
    const videoBlock =
      mediaType === 'VIDEO'
        ? `
Reglas de videoPrompt (CRÍTICO — el video es un SHORT vertical 9:16 de ${durationSeconds}s):
- videoPrompt en inglés, cinematográfico, para text-to-video (Kling / Seedance).
- Plano vertical 9:16, una sola toma continua (no pidas varios clips ni cortes).
- Pieza de marketing para redes (Reels / Status / Story), no un video casero.
- UNA acción principal clara y continua para todo el shot. No apiles a la vez: manipular varios objetos + manos complejas + desplazarse + cámara compleja.
- Cámara simple: locked-off o un solo movimiento suave. slow, controlled movement. one clear primary action. one smooth continuous action.
- Si la escena incluye manos, utensilios o un objeto manipulado, describí en el videoPrompt: qué objeto es, qué mano lo sostiene, cómo se sostiene y el tipo de movimiento (lento, estable, continuo). Usá tono positivo: natural hand movement, stable realistic grip, realistic physical interaction, consistent object shape and size. Ejemplo: "The chef slowly stirs the food using a wooden spoon held firmly in the right hand. The hand maintains a stable, natural grip. One smooth and controlled continuous movement. The spoon remains consistent in shape and size throughout the action."
- Si es talking-head, producto o local SIN manos/utensilios, NO inventes props ni gestos de manos: que hable o se vea el producto, con movimiento mínimo.
- VOZ OBLIGATORIA: el video NUNCA es mudo. Siempre hay una voz humana hablando en español rioplatense.
  Preferí un protagonista a cámara (owner/staff/customer) talking to camera with audible speech and lip-sync.
  Si no hay persona en frame, usá voice-over clara sobre el B-roll.
- El videoPrompt DEBE incluir las frases habladas EXACTAS entre comillas (español con tildes correctas) y pedir generate spoken audio / talking.
- Si USER REQUEST / Instructions trae un bloque VOZ, usá esas frases literales.
- NO pidas texto, captions, headlines, logos ni watermarks DENTRO del video.
  El texto on-screen (hook/CTA) y el logo los aplica después nuestra app con FFmpeg.
- Si hay REFERENCE IMAGES, usalas como look del local/producto/estilo (sin tipografía).

Reglas de overlay (editing) — la app las quema DESPUÉS, no FAL/Kling:
- El video DEBE salir listo para redes: preferí add_hook, add_cta y add_logo en true (si hay logo).
- hook: frase corta en español (máx ~8 palabras), gancho de atención. No pongas tiempos fijos de un ejemplo.
- cta: frase corta accionable para el cierre (puede coincidir con el campo cta).
- caption + hashtags: SOLO metadata de publicación. NUNCA van dentro del video.
- No inventes segundos fuera de 0–${durationSeconds}. Si no estás seguro, OMITÍ hook_start/hook_end/cta_start/cta_end y la app elige ventanas largas.
- hook_position: top. cta_position: bottom.
- logo_position: top-right (el CTA vive abajo; no pongas el logo abajo).

Respondé SOLO con un objeto JSON con las keys:
  topic, objective, headline, caption, cta, hook, hashtags, imagePrompt, videoPrompt, visualStyle, serviceId, audience, contentStyle, editing`
        : `
Respondé SOLO con un objeto JSON con las keys:
  topic, objective, headline, caption, cta, hashtags, imagePrompt, visualStyle, serviceId, audience, contentStyle`;

    return `Sos un Content Agent de marketing visual para un negocio local.
Tu trabajo es crear UNA estrategia de publicación en JSON (sin markdown extra).

Reglas de copy:
- Caption en español rioplatense, natural. Los hashtags van en el array "hashtags" (máx 5), no hace falta repetirlos en el caption.
- Evitá repetir temas/headlines/CTA de RECENT CONTENT.
- CTA claro y accionable.
${SPANISH_ORTHOGRAPHY_RULE}
- headline, caption, cta, hook y las frases habladas entre comillas del videoPrompt DEBEN llevar tildes correctas.
- Si hay branding, respetá colores, estilo, audiencia y "evitar".
- Si hay CONTENT GUIDELINES, son la fuente de verdad del enfoque del negocio (público, tono, qué publicar, qué evitar). Respetalas por encima del brief genérico.
- contentStyle debe ser exactamente EDUCATIONAL, COMEDY o SALES:
  EDUCATIONAL = enseña, explica, tip útil, desmitifica.
  COMEDY = humor ligero, situación reconocible, sin ofender.
  SALES = empuja a reservar / comprar / escribir, con beneficio claro.
- Si el pedido pide AUTO, detectá el estilo más fuerte para el negocio y el brief. Si pide uno fijo, respetalo.
Reglas de imagePrompt (CRÍTICO — la imagen debe ser una PIEZA DE MARKETING, no una foto suelta):
- imagePrompt en inglés, estilo publicitario / social ad / flyer digital.
- NUNCA le pidas al modelo que reproduzca, redibuje o incluya el logo. Frases prohibidas: "include the business logo", "recreate the logo", "add the logo", "place the logo in the image", "brand mark with logo".
- El logo original se aplica DESPUÉS de forma programática vía BrandingRenderer (Sharp, resize proporcional, preserve alpha, posición bottom-right por defecto). Dejá margen seguro limpio pero NO dibujes el logo.
- Diferenciá: GENERATIVE BRAND ELEMENTS (sí en prompt) = colores de marca, estilo visual, mood, composición, tipografía del headline (no del logo).
- EXACT BRAND ASSETS (NO generar) = logo, QR, códigos — se componen después sin modificación.
- Si no hay logo, podés incluir el nombre del negocio tipografiado de forma legible como marca genérica, manteniendo jerarquía limpia.
- Para FEED_SQUARE 1:1: NO renderices ningún texto/headline en la imagen. Dejá un área superior limpia (15% altura) con fondo sólido, sin tipografía. El headline se agregará después vía BrandingRenderer (Sharp) arriba con 8% margen.
- Para otros formatos (STORY_VERTICAL, etc.): Renderiza el headline del brief como texto nítido, centrado arriba, con al menos 5% margen seguro desde borde superior/izquierdo/derecho, nunca cortado, alto contraste, pocas palabras.
- Jerarquía: foto/hero + headline (solo si no es FEED_SQUARE) arriba con margen seguro + colores de marca (sin logo).
- Si Objective es OFFER: badge "OFERTA"/"PROMO"/"% OFF" legible (no garabatos) + colores de marca.
- Si Objective es SERVICE_PROMOTION: hero del servicio + headline corto.
- Si Objective es SPECIAL_DATE: badge de ocasión + estética de marca.
- Evitá texto ilegible, Lorem Ipsum, letras inventadas o párrafos largos.
- Preferí tipografía sans limpia, contraste alto, márgenes seguros para story/feed.
- Si hay REFERENCE IMAGES, usalas como contexto (producto/local/estilo) dentro de la pieza, no como foto cruda.
- NO menciones LOGO_URL ni pidas logo en imagePrompt.${videoBlock}`;
  }

  private buildUserPrompt(params: {
    business: {
      name: string;
      description: string | null;
      type: string;
      timezone: string;
      brandingConfig: {
        logoUrl: string | null;
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
    mediaType: ContentMediaType;
    durationSeconds: number;
    contentStyle: ContentStyle;
    contentGuidelines?: string;
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
      const hasLogo = Boolean(brand?.logoUrl?.trim());
      const brandBlock = brand
      ? [
          `Has logo: ${hasLogo ? 'true — EL LOGO SE APLICA DESPUÉS PROGRAMÁTICAMENTE, NO LO INCLUYAS EN imagePrompt' : 'false — podés incluir el nombre tipografiado si aporta a la composición'}`,
          `Brand colors (GENERATIVE, podés usarlos en la paleta): ${brand.primaryColor || '—'} / ${brand.secondaryColor || '—'}`,
          `Visual style (GENERATIVE): ${brand.visualStyle || '—'}`,
          `Commercial tone: ${brand.commercialTone || '—'}`,
          `Audience: ${brand.targetAudience || '—'}`,
          `Preferir: ${brand.preferNotes || '—'}`,
          `Evitar: ${brand.avoidNotes || '—'}`,
          `Extra: ${brand.additionalInstructions || '—'}`,
          hasLogo
            ? 'BRANDING RENDERER: el logo original se compone después con Sharp (resize proporcional, posición bottom-right por defecto, transparencia preservada). NO pidas "include logo", "recreate logo", "add logo" en el prompt.'
            : `Sin logo: podés incluir el nombre tipografiado "${params.business.name}" de forma legible si ayuda a la composición, manteniendo jerarquía limpia.`,
        ].join('\n')
      : `Sin branding configurado. Generá una pieza genérica limpia; si incluís texto de marca, usa solo "${params.business.name}" tipografiado.`;

    const recentBlock =
      params.recent
        .map(
          (r) =>
            `- ${r.objective} | ${r.topic || '—'} | ${r.headline || '—'} | CTA: ${r.cta || '—'}`,
        )
        .join('\n') || 'Sin publicaciones previas.';

    const formatHint =
      params.mediaType === 'VIDEO'
        ? `Priorizar SHORT vertical 9:16 (${params.durationSeconds}s) CON VOZ HUMANA y UNA acción principal continua. Cámara simple. El videoPrompt debe incluir diálogo hablado en español (protagonista a cámara o locución). Si hay manos/utensilios, describí agarre y un solo movimiento. NO texto on-screen; hook/CTA/logo van en editing.`
        : params.channels.some(
              (c) =>
                c === 'INSTAGRAM_STORY' ||
                c === 'FACEBOOK_STORY' ||
                c === 'WHATSAPP_STATUS' ||
                c === 'INSTAGRAM_REEL' ||
                c === 'FACEBOOK_REEL' ||
                c === 'TIKTOK',
            )
          ? 'Priorizar composición vertical 9:16 (story/status) con marca y headline seguros en zona central/superior.'
          : 'Priorizar composición cuadrada/feed con marca visible y headline corto.';

    const objectiveVisual =
      params.objective === 'OFFER'
        ? 'VISUAL OFFER: badge/sello "OFERTA" o "% OFF" grande y legible + nombre/logo del negocio.'
        : params.objective === 'SERVICE_PROMOTION'
          ? 'VISUAL SERVICE: hero del servicio + nombre/logo del negocio + headline corto del servicio.'
          : params.objective === 'SPECIAL_DATE'
            ? 'VISUAL SPECIAL DATE: badge de la ocasión + nombre/logo del negocio.'
            : 'VISUAL BRAND: toda pieza debe llevar nombre o logo del negocio de forma clara.';

    const styleGuide =
      params.contentStyle === 'EDUCATIONAL'
        ? 'CONTENT STYLE: EDUCATIONAL — enseñá algo útil del rubro; claridad > presión de venta.'
        : params.contentStyle === 'COMEDY'
          ? 'CONTENT STYLE: COMEDY — humor ligero y reconocible; nunca ofendas clientes ni el rubro.'
          : params.contentStyle === 'SALES'
            ? 'CONTENT STYLE: SALES — beneficio + CTA fuerte a reservar/escribir/comprar.'
            : 'CONTENT STYLE: AUTO — detectá EDUCATIONAL, COMEDY o SALES según el brief, la audiencia y los lineamientos. Devolvé contentStyle en el JSON.';

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
      'CONTENT GUIDELINES (lineamientos del negocio; priorizá esto)',
      params.contentGuidelines?.trim() ||
        'Sin lineamientos cargados. Usá branding + brief.',
      '',
      'RECENT CONTENT (evitar repetir)',
      recentBlock,
      '',
      'USER REQUEST',
      `Objective: ${params.objective}`,
      styleGuide,
      `Content style request: ${CONTENT_STYLE_LABEL[params.contentStyle]} (${params.contentStyle})`,
      objectiveVisual,
      `Media type: ${params.mediaType}`,
      `Channels: ${params.channels.join(', ')}`,
      `Selected service: ${
        params.selectedService
          ? `${params.selectedService.name} (${params.selectedService.id})`
          : 'ninguno'
      }`,
      `Instructions: ${params.userInstructions?.trim() || '—'}`,
      `Format hint: ${formatHint}`,
      `Reference images attached (user): ${params.referenceImageCount}`,
      params.referenceImageCount > 0
        ? 'Las imágenes adjuntas del usuario son contexto visual (producto/local/estilo) para integrar en la pieza de marketing. El logo NO está entre ellas y NO debe ser recreado.'
        : '',
      brand?.logoUrl?.trim()
        ? 'LOGO: el logo original se aplicará después vía BrandingRenderer (Sharp). NO lo describas ni lo pidas en imagePrompt. Dejá margen seguro limpio en la composición (ej. esquina bottom-right) pero sin dibujar el logo.'
        : `Sin logo: podés incluir el nombre tipografiado "${params.business.name}" solo si mejora la jerarquía, sin forzar recreación del logo.`,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
