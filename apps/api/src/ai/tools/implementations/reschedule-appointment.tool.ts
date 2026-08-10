import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';
import { AppointmentsService } from '../../../calendar/appointments.service';

const schema = z.object({
  appointmentId: z.string().uuid(),
  startsAt: z
    .string()
    .describe('Nuevo inicio ISO 8601 con offset'),
});

@Injectable()
export class RescheduleAppointmentTool implements AgentTool {
  readonly name = 'rescheduleAppointment';
  readonly description =
    'Reprograma una cita existente a un nuevo horario disponible.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(private readonly appointments: AppointmentsService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    try {
      const appointment = await this.appointments.reschedule(
        context.businessId,
        data.appointmentId,
        new Date(data.startsAt),
      );
      return {
        success: true,
        data: {
          appointment: {
            id: appointment.id,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
            status: appointment.status,
            service: appointment.service,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo reprogramar la cita',
      };
    }
  }
}
