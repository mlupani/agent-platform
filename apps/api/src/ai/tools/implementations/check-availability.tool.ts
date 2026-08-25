import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';
import { AppointmentsService } from '../../../calendar/appointments.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveServiceId } from '../resolve-service';

const schema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá fecha YYYY-MM-DD')
    .describe(
      'Fecha a consultar en YYYY-MM-DD. Debe basarse en la fecha actual del system prompt (hoy/mañana/esta semana).',
    ),
  serviceId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'UUID del servicio (preferido) o nombre exacto, p.ej. "Consulta inicial".',
    ),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Usá hora HH:mm')
    .optional()
    .describe(
      'Hora solicitada por el cliente en HH:mm (ej. "18:00"). Si el cliente pidió un horario, mandalo.',
    ),
  // alias para compatibilidad con prompts viejos que puedan mandar startTime
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Usá hora HH:mm')
    .optional()
    .describe('Alias de time'),
});

@Injectable()
export class CheckAvailabilityTool implements AgentTool {
  readonly name = 'checkAvailability';
  readonly description =
    'Consulta turnos y cupos de clase para una fecha YYYY-MM-DD (derivada de hoy/mañana según la fecha actual del prompt). Si el cliente pidió una hora (ej. "18:00"), incluye time=HH:mm para chequear ese horario puntual con remaining/capacity; si no, devuelve todos los horarios del día. Cruza horarios del negocio con Google Calendar si está conectado. serviceId puede ser UUID o nombre.';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(
    private readonly appointments: AppointmentsService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    let serviceId = data.serviceId;
    if (data.serviceId) {
      const resolved = await resolveServiceId(
        this.prisma,
        context.businessId,
        data.serviceId,
      );
      if (!resolved) {
        return {
          success: false,
          error: `Servicio no encontrado: "${data.serviceId}". Usá el id o el nombre exacto del prompt.`,
        };
      }
      serviceId = resolved.id;
    }

    const requestedTime = (data.time ?? data.startTime)?.trim() || undefined;

    const result = await this.appointments.checkAvailability({
      businessId: context.businessId,
      date: data.date,
      serviceId,
      durationMinutes: data.durationMinutes,
    });

    if (result.isPast) {
      return {
        success: false,
        error:
          result.warning ||
          `Fecha en el pasado (${result.date}). Hoy es ${result.today}. Reintentá con una fecha futura.`,
        data: {
          date: result.date,
          dayLabel: result.dayLabel,
          today: result.today,
          timezone: result.timezone,
        },
      };
    }

    // Si el cliente pidió hora puntual, filtrar y responder específico
    if (requestedTime) {
      const slot = result.slots.find((s) => s.start === requestedTime);
      if (slot) {
        return {
          success: true,
          data: {
            ...result,
            requestedTime,
            requestedSlot: slot,
            hint: `El horario ${requestedTime} del ${result.dayLabel || result.date} tiene ${slot.remaining}/${slot.capacity} lugares libres (servicio ${result.serviceName ?? result.serviceId ?? 'general'}). Confirmá que el cliente quiere ESE horario y si dice que sí, llamá createAppointment con startsAt=${slot.startIso}. Si no, ofrecé 2–3 alternativas del mismo día.`,
          },
        };
      }
      // hora pedida no es un inicio habitual → informar y ofrecer alternativas sin inventar
      return {
        success: true,
        data: {
          ...result,
          requestedTime,
          requestedSlot: null,
          hint:
            result.slots.length === 0
              ? `El horario ${requestedTime} no es un inicio habitual ese día y no hay otros turnos libres. Probá otra fecha o derivá a un humano.`
              : `El horario ${requestedTime} no es un inicio habitual ese día. Ofrecé 2–4 alternativas reales de ${result.dayLabel || result.date} de esta lista (con remaining/capacity): ${result.slots.map((s) => `${s.start} · ${s.remaining}/${s.capacity}`).join(', ')}. No inventes ${requestedTime} como disponible y no llames de nuevo checkAvailability para la misma fecha.`,
        },
      };
    }

    return {
      success: true,
      data: {
        ...result,
        hint:
          result.slots.length === 0
            ? 'Sin turnos libres ese día (horarios del negocio y/o calendario). Probá otra fecha o derivá a un humano.'
            : `Respondé YA al cliente con 2–4 opciones de ${result.dayLabel || result.date}, indicando lugares (ej. 09:00 · 7 lugares) si el slot trae remaining/capacity. No vuelvas a llamar getServices ni checkAvailability para la misma fecha.`,
      },
    };
  }
}
