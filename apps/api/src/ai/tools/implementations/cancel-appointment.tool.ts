import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';
import { AppointmentsService } from '../../../calendar/appointments.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const schema = z.object({
  appointmentId: z.string().uuid().optional(),
  contactPhone: z.string().optional(),
  reason: z.string().optional(),
});

@Injectable()
export class CancelAppointmentTool implements AgentTool {
  readonly name = 'cancelAppointment';
  readonly description =
    'Cancela una cita por id o, si no hay id, la próxima del teléfono del contacto.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(
    private readonly appointments: AppointmentsService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    try {
      let id = data.appointmentId;
      if (!id) {
        const phone =
          data.contactPhone ||
          (context.metadata?.contactPhone
            ? String(context.metadata.contactPhone)
            : undefined);
        const upcoming = await this.appointments.findForContact(
          context.businessId,
          phone,
        );
        if (!upcoming.length) {
          return {
            success: false,
            error: 'No encontré citas activas para cancelar.',
          };
        }
        id = upcoming[0].id;
      }

      const appointment = await this.appointments.cancel(
        context.businessId,
        id,
        data.reason,
      );
      const business = await this.prisma.business.findUniqueOrThrow({
        where: { id: context.businessId },
      });
      const messages = (business.defaultMessages ?? {}) as Record<
        string,
        string
      >;

      return {
        success: true,
        data: {
          appointment: {
            id: appointment.id,
            status: appointment.status,
            startsAt: appointment.startsAt,
          },
          cancellationMessage:
            messages.appointmentCancellation ?? 'Tu cita fue cancelada.',
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cancelar la cita',
      };
    }
  }
}
