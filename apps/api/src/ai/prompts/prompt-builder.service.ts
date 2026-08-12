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
  buildCurrentDateTime(timezone: string): NonNullable<
    AgentPromptContext['currentDateTime']
  > {
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
      this.toolsSection(ctx.enabledTools),
      ctx.memoryContext
        ? `Contexto de conversación / memoria:\n${ctx.memoryContext}`
        : null,
      ctx.knowledgeContext
        ? `Información del negocio que podés usar para responder (no inventes fuera de esto ni de las herramientas):\n${ctx.knowledgeContext}`
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
      parts.memoryContext
        ? `Memoria relevante:\n${parts.memoryContext}`
        : null,
      parts.ragContext
        ? `Información del negocio que podés usar para responder (no inventes fuera de esto ni de las herramientas):\n${parts.ragContext}`
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

  private toolsSection(enabledTools: string[]): string {
    if (!enabledTools.length) {
      return 'No hay herramientas habilitadas. Respondé solo con la información disponible en este prompt.';
    }
    return [
      `Herramientas habilitadas: ${enabledTools.join(', ')}.`,
      `Horarios y servicios ya están en este prompt: no llames getOpeningHours/getServices salvo que falte un dato concreto.`,
      `Para turnos: checkAvailability → respondé al usuario con 2–4 horarios → createAppointment solo si pide reservar. Nunca inventes horarios libres.`,
      `En createAppointment/checkAvailability, serviceId puede ser el UUID (id=... del prompt) o el nombre exacto del servicio.`,
      `Si el usuario dio email y createAppointment fue exitoso, usá sendEmail de inmediato para mandar la confirmación (fecha, hora, servicio, datos del negocio). No inventes destinatarios.`,
      `No pidas autorización verbal extra para sendEmail: si el usuario pidió el email de confirmación y ya dio su correo, ejecutá sendEmail sin repreguntar.`,
      `Si sendEmail falla, confirmá el turno en este chat con los datos del turno. No digas que "falta una integración" ni derives a un humano salvo que el usuario lo pida.`,
      `checkAvailability exige fecha YYYY-MM-DD según la fecha actual del prompt; si avisa fecha pasada, corregí UNA vez y reintentá.`,
      `No repitas la misma herramienta con los mismos argumentos. Después de un resultado exitoso, contestá al usuario.`,
      `Para derivar a un humano: requestHumanAssistance.`,
    ].join('\n');
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
      durationMinutes: number;
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
        return `- ${service.name}${idPart} (${service.durationMinutes} min) — ${price}${
          service.description ? `: ${service.description}` : ''
        }${service.requiresAppointment ? ' [requiere cita]' : ''}`;
      })
      .join('\n');
  }
}
