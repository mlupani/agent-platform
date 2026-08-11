import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';
import { AppointmentsService } from '../../../calendar/appointments.service';

const schema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá fecha YYYY-MM-DD')
    .describe(
      'Fecha a consultar en YYYY-MM-DD. Debe basarse en la fecha actual del system prompt (hoy/mañana/esta semana).',
    ),
  serviceId: z.string().uuid().optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
});

@Injectable()
export class CheckAvailabilityTool implements AgentTool {
  readonly name = 'checkAvailability';
  readonly description =
    'Consulta turnos libres para una fecha YYYY-MM-DD (derivada de hoy/mañana según la fecha actual del prompt). Cruza horarios del negocio con Google Calendar si está conectado.';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(private readonly appointments: AppointmentsService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    const result = await this.appointments.checkAvailability({
      businessId: context.businessId,
      date: data.date,
      serviceId: data.serviceId,
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

    return {
      success: true,
      data: {
        ...result,
        hint:
          result.slots.length === 0
            ? 'Sin turnos libres ese día (horarios del negocio y/o calendario). Probá otra fecha o derivá a un humano.'
            : `Respondé YA al cliente con 2–4 opciones de ${result.dayLabel || result.date}. No vuelvas a llamar getServices ni checkAvailability para la misma fecha.`,
      },
    };
  }
}
