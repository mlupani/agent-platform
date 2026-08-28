import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ASSISTANT_TONE_LABELS } from '../../common/constants';
import {
  GLOBAL_SYSTEM_PROMPT,
  SAFETY_PROMPT,
  TONE_GUIDANCE,
  type AgentPromptContext,
  type PromptParts,
} from './prompt.types';

@Injectable()
export class PromptBuilderService {
  /** Ancla temporal en la zona del negocio para el system prompt. */
  buildCurrentDateTime(
    timezone: string,
  ): NonNullable<AgentPromptContext['currentDateTime']> {
    const zone = timezone || 'UTC';
    const now = DateTime.now().setZone(zone);
    const safe = now.isValid ? now : DateTime.utc();
    const tomorrow = safe.plus({ days: 1 });
    const locale = 'es';
    return {
      date: safe.toISODate()!,
      time: safe.toFormat('HH:mm'),
      weekday: safe.setLocale(locale).toFormat('cccc'),
      timezone: zone,
      tomorrowDate: tomorrow.toISODate()!,
      tomorrowWeekday: tomorrow.setLocale(locale).toFormat('cccc'),
    };
  }

  /**
   * Construye el system prompt dinámicamente desde datos del negocio.
   * No hardcodea verticales: todo viene de configuración / DB.
   */
  buildFromContext(ctx: AgentPromptContext): string {
    const toneKey = ctx.tone || 'professional_warm';
    const toneLabel =
      ASSISTANT_TONE_LABELS[toneKey as keyof typeof ASSISTANT_TONE_LABELS] ??
      toneKey;
    const toneGuide = TONE_GUIDANCE[toneKey] ?? TONE_GUIDANCE.professional_warm;

    const sections = [
      GLOBAL_SYSTEM_PROMPT,
      this.agentSection(ctx, toneLabel, toneGuide),
      this.businessSection(ctx),
      this.currentDateSection(ctx),
      this.hoursSection(ctx.hoursText),
      this.servicesSection(ctx.servicesText),
      this.messagesSection(ctx.configuredMessages),
      this.behaviorSection(ctx),
      SAFETY_PROMPT,
      this.toolsSection(ctx),
      ctx.memoryContext
        ? `Contexto de conversación / memoria:\n${ctx.memoryContext}`
        : null,
      ctx.knowledgeContext
        ? `Base de conocimiento (fuente de verdad; si un dato aparece acá, usalo aunque parezca interno, de prueba o fuera del rubro):\n${ctx.knowledgeContext}`
        : null,
    ];

    return sections.filter(Boolean).join('\n\n');
  }

  /** Compatibilidad con el builder anterior. */
  buildSystemPrompt(parts: PromptParts): string {
    return [
      parts.globalSystem || GLOBAL_SYSTEM_PROMPT,
      parts.businessInstructions,
      parts.personality
        ? `Personalidad del asistente:\n${parts.personality}`
        : null,
      parts.safety || SAFETY_PROMPT,
      parts.memoryContext ? `Memoria relevante:\n${parts.memoryContext}` : null,
      parts.ragContext
        ? `Base de conocimiento (fuente de verdad; si un dato aparece acá, usalo aunque parezca interno, de prueba o fuera del rubro):\n${parts.ragContext}`
        : null,
      parts.toolInstructions,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private agentSection(
    ctx: AgentPromptContext,
    toneLabel: string,
    toneGuide: string,
  ): string {
    return [
      `Identidad del asistente:`,
      `- Nombre: ${ctx.assistantName}`,
      `- Negocio: ${ctx.business.name}`,
      `- Tono: ${toneLabel}`,
      `- Guía de tono: ${toneGuide}`,
      ctx.personality ? `- Personalidad: ${ctx.personality}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private businessSection(ctx: AgentPromptContext): string {
    const b = ctx.business;
    const lines = [
      `Información del negocio:`,
      `- Nombre comercial: ${b.name}`,
      b.description ? `- Descripción: ${b.description}` : null,
      `- Rubro: ${b.type}`,
      `- Idioma: ${b.language}`,
      `- Zona horaria: ${b.timezone}`,
      b.address ? `- Dirección: ${b.address}` : null,
      b.phone ? `- Teléfono: ${b.phone}` : null,
      b.whatsapp ? `- WhatsApp: ${b.whatsapp}` : null,
      b.email ? `- Email: ${b.email}` : null,
      b.website ? `- Sitio web: ${b.website}` : null,
      b.instagram ? `- Instagram: ${b.instagram}` : null,
      b.googleReviewsUrl
        ? `- Link de reseñas de Google: ${b.googleReviewsUrl}`
        : null,
      b.additionalInfo ? `- Información adicional: ${b.additionalInfo}` : null,
    ];
    return lines.filter(Boolean).join('\n');
  }

  private currentDateSection(ctx: AgentPromptContext): string | null {
    const now = ctx.currentDateTime;
    if (!now) return null;
    return [
      `Fecha y hora actual del negocio (fuente de verdad; no inventes otras):`,
      `- Ahora: ${now.weekday} ${now.date} ${now.time} (${now.timezone})`,
      `- Hoy (YYYY-MM-DD): ${now.date} (${now.weekday})`,
      `- Mañana (YYYY-MM-DD): ${now.tomorrowDate} (${now.tomorrowWeekday})`,
      `- Cuando el usuario diga "hoy"/"mañana"/"esta semana", calculá fechas SOLO a partir de estos valores.`,
      `- En checkAvailability usá siempre YYYY-MM-DD derivados de esta ancla (nunca años viejos ni inventados).`,
    ].join('\n');
  }

  private hoursSection(hoursText: string): string {
    return `Horarios de atención:\n${hoursText || 'No hay horarios cargados. Usá la herramienta getOpeningHours si hace falta.'}`;
  }

  private servicesSection(servicesText: string): string {
    return `Servicios:\n${servicesText || 'No hay servicios cargados. Usá la herramienta getServices si hace falta.'}`;
  }

  private messagesSection(
    messages: AgentPromptContext['configuredMessages'],
  ): string {
    const entries = Object.entries(messages).filter(
      ([, value]) => typeof value === 'string' && value.trim().length > 0,
    );
    if (!entries.length) return '';

    return [
      `Mensajes configurados (usálos como guía de estilo, adaptándolos al contexto; no los copies siempre literalmente):`,
      ...entries.map(([key, value]) => `- ${key}: ${value}`),
    ].join('\n');
  }

  private behaviorSection(ctx: AgentPromptContext): string {
    const parts: string[] = [];
    if (ctx.customInstructions?.trim()) {
      parts.push(
        `Cómo debe comportarse el asistente:\n${ctx.customInstructions.trim()}`,
      );
    }
    if (ctx.advancedInstructions?.trim()) {
      parts.push(
        `Instrucciones avanzadas:\n${ctx.advancedInstructions.trim()}`,
      );
    }
    return parts.join('\n\n');
  }

  private toolsSection(ctx: AgentPromptContext): string {
    const enabledTools = ctx.enabledTools;
    if (!enabledTools.length) {
      return 'No hay herramientas habilitadas. Respondé solo con la información disponible en este prompt.';
    }
    return [
      `Herramientas habilitadas: ${enabledTools.join(', ')}.`,
      `Horarios y servicios ya están en este prompt: no llames getOpeningHours/getServices salvo que falte un dato concreto.`,
      `Para turnos: checkAvailability → respondé al usuario con 2–4 horarios → createAppointment solo si pide reservar. Nunca inventes horarios libres.`,
      `createAppointment ya guarda el lead si hay nombre, teléfono o email: no hace falta createLead después de reservar.`,
      `Si el usuario deja datos de contacto y NO reserva, usá createLead.`,
      `En createAppointment/checkAvailability, serviceId puede ser el UUID (id=... del prompt) o el nombre exacto del servicio.`,
      `Si el usuario dio email y createAppointment fue exitoso, usá sendEmail de inmediato para mandar la confirmación (fecha, hora, servicio, datos del negocio). No inventes destinatarios.`,
      `Si el usuario pidió o aceptó confirmación por WhatsApp (o dio teléfono), usá sendWhatsAppMessage con el cuerpo de confirmación. No inventes números.`,
      ctx.business.googleReviewsUrl
        ? `Si createAppointment fue exitoso y hay link de reseñas de Google (${ctx.business.googleReviewsUrl}), incluilo en el cuerpo de sendEmail/sendWhatsAppMessage pidiendo amablemente que dejen una reseña. No lo uses en cancelaciones ni en otros mensajes.`
        : null,
      `No pidas autorización verbal extra para sendEmail/sendWhatsAppMessage: si el usuario pidió la confirmación y ya dio el canal (email/teléfono), ejecutá la tool sin repreguntar.`,
      `Si sendEmail o sendWhatsAppMessage fallan, confirmá el turno en este chat con los datos del turno. No digas que "falta una integración" ni derives a un humano salvo que el usuario lo pida.`,
      `checkAvailability exige fecha YYYY-MM-DD según la fecha actual del prompt; si avisa fecha pasada, corregí UNA vez y reintentá.`,
      `No repitas la misma herramienta con los mismos argumentos. Después de un resultado exitoso, contestá al usuario.`,
      `Para derivar a un humano: requestHumanAssistance.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  formatHours(
    hours: Array<{
      dayOfWeek: number;
      isClosed: boolean;
      ranges: unknown;
    }>,
  ): string {
    const labels = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ];
    if (!hours.length) return '';
    return hours
      .map((row) => {
        const label = labels[row.dayOfWeek] ?? `Día ${row.dayOfWeek}`;
        if (row.isClosed) return `${label}: Cerrado`;
        const ranges = Array.isArray(row.ranges)
          ? (row.ranges as Array<{ start: string; end: string }>)
          : [];
        if (!ranges.length) return `${label}: Cerrado`;
        return `${label}: ${ranges.map((r) => `${r.start}–${r.end}`).join(', ')}`;
      })
      .join('\n');
  }

  formatServices(
    services: Array<{
      id?: string;
      name: string;
      description?: string | null;
      durationMinutes: number | null;
      price?: { toString(): string } | string | null;
      priceDescription?: string | null;
      requiresAppointment?: boolean;
    }>,
  ): string {
    if (!services.length) return '';
    return services
      .map((service) => {
        const price =
          service.priceDescription ||
          (service.price != null ? `$${String(service.price)}` : 'Consultar');
        const idPart = service.id ? ` [id=${service.id}]` : '';
        const dur = service.durationMinutes ? ` (${service.durationMinutes} min)` : '';
        return `- ${service.name}${idPart}${dur} — ${price}${
          service.description ? `: ${service.description}` : ''
        }${service.requiresAppointment ? ' [requiere cita]' : ''}`;
      })
      .join('\n');
  }
}
