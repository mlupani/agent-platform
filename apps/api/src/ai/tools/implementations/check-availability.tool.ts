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
    'Consulta turnos y cupos de clase para una fecha YYYY-MM-DD. Si el cliente pidió hora (ej. "18:00") incluye time=HH:mm. serviceId es OPCIONAL: solo mandalo si el cliente mencionó el servicio por nombre o si el leadContext indica que es alumna con servicio contratado (ej. Pack 4). Para clase de prueba / primera visita / visita sin servicio conocido, NO mandes serviceId para ver disponibilidad general. Devuelve remaining/capacity.';
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

    const fullSlots = result.fullSlots ?? [];
    const dayName = result.dayLabel || result.date;
    const alternatives = result.slots
      .map((s) => `${s.start} · ${s.remaining}/${s.capacity} lugares`)
      .join(', ');
    const fullTimes = fullSlots.map((s) => s.start).join(', ');

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
            hint: `El horario ${requestedTime} del ${dayName} tiene ${slot.remaining}/${slot.capacity} lugares libres (servicio ${result.serviceName ?? result.serviceId ?? 'general'}). Confirmá que el cliente quiere ESE horario y si dice que sí, llamá createAppointment con startsAt=${slot.startIso}. Si no, ofrecé 2–3 alternativas del mismo día.`,
          },
        };
      }

      // La clase existe a esa hora pero ya no tiene cupo → decirlo claro, no "horario raro"
      const full = fullSlots.find((s) => s.start === requestedTime);
      if (full) {
        return {
          success: true,
          data: {
            ...result,
            requestedTime,
            requestedSlot: null,
            classFull: true,
            hint: result.slots.length
              ? `La clase de las ${requestedTime} del ${dayName} ya está completa (${full.capacity}/${full.capacity} lugares ocupados): no tiene cupo. Decíselo al cliente con esas palabras y ofrecé 2–4 alternativas reales del mismo día: ${alternatives}. No vuelvas a llamar checkAvailability para esta fecha.`
              : `La clase de las ${requestedTime} del ${dayName} ya está completa (sin cupo) y no quedan otras clases con lugar ese día. Decíselo así al cliente y ofrecé otra fecha o derivá a un humano. No vuelvas a llamar checkAvailability para esta fecha.`,
          },
        };
      }

      // No hay ninguna clase que arranque a esa hora
      return {
        success: true,
        data: {
          ...result,
          requestedTime,
          requestedSlot: null,
          hint: result.slots.length
            ? `Ese día no hay ninguna clase que empiece a las ${requestedTime}. Aclarale al cliente que no hay clase a esa hora y ofrecé 2–4 alternativas reales del ${dayName}: ${alternatives}. No inventes ${requestedTime} como disponible ni vuelvas a llamar checkAvailability para esta fecha.`
            : `Ese día no hay ninguna clase a las ${requestedTime} ni otros horarios con lugar. Ofrecé otra fecha o derivá a un humano. No vuelvas a llamar checkAvailability para esta fecha.`,
        },
      };
    }

    return {
      success: true,
      data: {
        ...result,
        hint:
          result.slots.length === 0
            ? fullSlots.length
              ? `Todas las clases del ${dayName} ya están completas (${fullTimes}): no queda cupo. Decíselo al cliente y ofrecé otra fecha.`
              : 'Sin turnos libres ese día (horarios del negocio y/o calendario). Probá otra fecha o derivá a un humano.'
            : `Respondé YA al cliente con 2–4 opciones de ${dayName}, indicando lugares (ej. 09:00 · 7 lugares) si el slot trae remaining/capacity. No vuelvas a llamar getServices ni checkAvailability para la misma fecha.`,
      },
    };
  }
}
