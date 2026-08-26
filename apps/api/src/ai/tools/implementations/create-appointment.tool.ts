import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';
import { AppointmentsService } from '../../../calendar/appointments.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LeadsService } from '../../../leads/leads.service';
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
  isTrial: z
    .boolean()
    .optional()
    .describe('true si es clase de prueba gratuita para PROSPECT (solo una vez por alumno). No usar para alumna con pack.'),
});

@Injectable()
export class CreateAppointmentTool implements AgentTool {
  private readonly logger = new Logger(CreateAppointmentTool.name);
  readonly name = 'createAppointment';
  readonly description =
    'Anota una cita o suma a una alumna a una clase con lugar (usar checkAvailability antes). serviceId puede ser UUID o nombre del servicio. También guarda el lead si hay datos de contacto.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(
    private readonly appointments: AppointmentsService,
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
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
    const contactEmail =
      data.contactEmail ||
      (context.metadata?.contactEmail
        ? String(context.metadata.contactEmail)
        : undefined);

    try {
      const appointment = await this.appointments.create({
        businessId: context.businessId,
        conversationId: context.conversationId,
        userId: context.userId,
        serviceId,
        contactName,
        contactPhone,
        contactEmail,
        startsAt: new Date(data.startsAt),
        timezone: business.timezone,
        notes: data.notes,
        isTrial: data.isTrial,
      });

      const messages = (business.defaultMessages ?? {}) as Record<
        string,
        string
      >;

      await this.captureLead(
        {
          id: appointment.id,
          contactName: appointment.contactName || contactName || null,
          contactEmail: appointment.contactEmail || contactEmail || null,
          contactPhone: appointment.contactPhone || contactPhone || null,
          service: appointment.service,
        },
        data.notes,
        context,
      );

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
            messages.appointmentConfirmation ?? 'Tu cita quedó confirmada.',
          googleReviewsUrl: business.googleReviewsUrl ?? undefined,
          reviewHint: business.googleReviewsUrl
            ? `Incluí este link de reseñas de Google en el email/WhatsApp de confirmación: ${business.googleReviewsUrl}`
            : undefined,
          emailHint: appointment.contactEmail
            ? 'Si el usuario dio email, podés usar sendEmail para mandar la confirmación.'
            : undefined,
          whatsappHint: appointment.contactPhone
            ? 'Si el usuario pidió o aceptó confirmación por WhatsApp, usá sendWhatsAppMessage para enviar la confirmación AHORA (fecha/hora/servicio). No prometas recordatorios futuros/programados por WhatsApp: los recordatorios son un sistema aparte (Agenda > Recordatorios).'
            : 'Si el usuario pide confirmación por WhatsApp y da su teléfono, usá sendWhatsAppMessage para enviar la confirmación inmediata. No ofrezcas recordatorios previos a la clase por WhatsApp.',
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'No se pudo crear la cita',
      };
    }
  }

  private async captureLead(
    appointment: {
      id: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      service?: { name: string } | null;
    },
    notes: string | undefined,
    context: ToolContext,
  ): Promise<void> {
    try {
      await this.leads.capture({
        businessId: context.businessId,
        conversationId: context.conversationId,
        userId: context.userId,
        name: appointment.contactName,
        email: appointment.contactEmail,
        phone: appointment.contactPhone,
        message:
          notes?.trim() ||
          (appointment.service?.name
            ? `Reserva: ${appointment.service.name}`
            : 'Reserva de turno'),
        source: context.channel,
        metadata: {
          appointmentId: appointment.id,
          conversationId: context.conversationId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el lead de la reserva ${appointment.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}
