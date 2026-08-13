import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';
import { AppointmentsService } from '../../../calendar/appointments.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveServiceId } from '../resolve-service';

const schema = z.object({
  startsAt: z
    .string()
    .describe('Inicio ISO 8601 con offset, p.ej. 2026-08-12T10:00:00-03:00'),
  serviceId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'UUID del servicio (preferido) o nombre exacto, p.ej. "Consulta inicial".',
    ),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
});

@Injectable()
export class CreateAppointmentTool implements AgentTool {
  readonly name = 'createAppointment';
  readonly description =
    'Reserva una cita en un horario disponible (usar checkAvailability antes). serviceId puede ser UUID o nombre del servicio.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(
    private readonly appointments: AppointmentsService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: context.businessId },
    });

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
          error: `Servicio no encontrado: "${data.serviceId}". Usá el id o el nombre exacto de getServices / prompt.`,
        };
      }
      serviceId = resolved.id;
    }

    const contactPhone =
      data.contactPhone ||
      (context.metadata?.contactPhone
        ? String(context.metadata.contactPhone)
        : undefined);
    const contactName =
      data.contactName ||
      (context.metadata?.contactName
        ? String(context.metadata.contactName)
        : undefined);

    try {
      const appointment = await this.appointments.create({
        businessId: context.businessId,
        conversationId: context.conversationId,
        userId: context.userId,
        serviceId,
        contactName,
        contactPhone,
        contactEmail: data.contactEmail,
        startsAt: new Date(data.startsAt),
        timezone: business.timezone,
        notes: data.notes,
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
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
            timezone: appointment.timezone,
            status: appointment.status,
            service: appointment.service,
            contactName: appointment.contactName,
            contactPhone: appointment.contactPhone,
            contactEmail: appointment.contactEmail,
          },
          confirmationMessage:
            messages.appointmentConfirmation ??
            'Tu cita quedó confirmada.',
          googleReviewsUrl: business.googleReviewsUrl ?? undefined,
          reviewHint: business.googleReviewsUrl
            ? `Incluí este link de reseñas de Google en el email/WhatsApp de confirmación: ${business.googleReviewsUrl}`
            : undefined,
          emailHint: appointment.contactEmail
            ? 'Si el usuario dio email, podés usar sendEmail para mandar la confirmación.'
            : undefined,
          whatsappHint: appointment.contactPhone
            ? 'Si el usuario pidió o aceptó confirmación por WhatsApp, usá sendWhatsAppMessage.'
            : 'Si el usuario pide confirmación por WhatsApp y da su teléfono, usá sendWhatsAppMessage.',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No se pudo crear la cita',
      };
    }
  }
}
