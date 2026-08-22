import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { GoogleCalendarService } from './google-calendar.service';
import type { CreateAppointmentInput } from './calendar.types';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly google: GoogleCalendarService,
  ) {}

  async list(
    businessId: string,
    filters?: {
      from?: string;
      to?: string;
      status?: string;
    },
  ) {
    return this.prisma.appointment.findMany({
      where: {
        businessId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.from || filters?.to
          ? {
              startsAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
  }

  /** Citas locales + eventos de Google Calendar (dedupe por googleEventId). */
  async listFeed(businessId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const [local, googleEvents, googleConnected] = await Promise.all([
      this.list(businessId, { from, to }),
      this.google.listEvents(businessId, fromDate, toDate),
      this.google.isConnected(businessId),
    ]);

    const localGoogleIds = new Set(
      local
        .map((item) => item.googleEventId)
        .filter((id): id is string => Boolean(id)),
    );

    const localItems = local
      .filter((item) => item.status !== 'cancelled')
      .map((item) => ({
        id: item.id,
        source: 'local' as const,
        title: item.service?.name
          ? `${item.service.name} · ${item.contactName || item.contactPhone || 'Cliente'}`
          : item.contactName || item.contactPhone || 'Cita',
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString(),
        allDay: false,
        status: item.status,
        contactName: item.contactName,
        contactPhone: item.contactPhone,
        contactEmail: item.contactEmail,
        notes: item.notes,
        googleEventId: item.googleEventId,
        htmlLink: null as string | null,
        canCancel: true,
        service: item.service,
      }));

    const googleItems = googleEvents
      .filter((event) => !localGoogleIds.has(event.id))
      .map((event) => ({
        id: `gcal:${event.id}`,
        source: 'google' as const,
        title: event.summary,
        // all-day: conservar YYYY-MM-DD para no correr el día por timezone
        startsAt: event.allDay
          ? event.startsAt.slice(0, 10)
          : new Date(event.startsAt).toISOString(),
        endsAt: event.allDay
          ? event.endsAt.slice(0, 10)
          : new Date(event.endsAt).toISOString(),
        allDay: event.allDay,
        status: event.status ?? 'confirmed',
        contactName: null as string | null,
        contactPhone: null as string | null,
        contactEmail: null as string | null,
        notes: event.description ?? null,
        googleEventId: event.id,
        htmlLink: event.htmlLink ?? null,
        canCancel: false,
        service: null as {
          id: string;
          name: string;
          durationMinutes?: number;
        } | null,
      }));

    const items = [...localItems, ...googleItems].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );

    return {
      googleConnected,
      items,
    };
  }

  async deleteFeedItem(
    businessId: string,
    source: 'local' | 'google',
    id: string,
  ) {
    if (source === 'google') {
      const eventId = id.startsWith('gcal:') ? id.slice('gcal:'.length) : id;
      const ok = await this.google.deleteEvent(businessId, eventId);
      if (!ok) {
        throw new BadRequestException(
          'No se pudo borrar el evento de Google Calendar',
        );
      }
      return { ok: true, source: 'google' as const };
    }

    await this.cancel(businessId, id, 'Eliminado desde el calendario');
    return { ok: true, source: 'local' as const };
  }

  async get(businessId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, businessId },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Cita no encontrada');
    return appointment;
  }

  async checkAvailability(params: {
    businessId: string;
    date: string;
    serviceId?: string;
    durationMinutes?: number;
  }) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: params.businessId },
    });

    let duration = params.durationMinutes ?? 30;
    let serviceName: string | undefined;
    if (params.serviceId) {
      const service = await this.prisma.service.findFirst({
        where: {
          id: params.serviceId,
          businessId: params.businessId,
          enabled: true,
        },
      });
      if (!service) throw new NotFoundException('Servicio no encontrado');
      duration = service.durationMinutes;
      serviceName = service.name;
    }

    const slots = await this.availability.getAvailableSlots({
      businessId: params.businessId,
      date: params.date,
      durationMinutes: duration,
      timezone: business.timezone,
    });

    const zone = business.timezone || 'UTC';
    const today = DateTime.now().setZone(zone).startOf('day');
    const day = DateTime.fromISO(params.date, { zone }).startOf('day');
    const dayValid = day.isValid;
    const dayLabel = dayValid ? day.setLocale('es').toFormat('cccc') : null;
    const isPast = dayValid && day < today;
    const isToday = dayValid && day.equals(today);

    return {
      date: params.date,
      dayLabel,
      today: today.toISODate(),
      isToday,
      isPast,
      timezone: business.timezone,
      durationMinutes: duration,
      serviceId: params.serviceId ?? null,
      serviceName: serviceName ?? null,
      slots,
      googleConnected: await this.google.isConnected(params.businessId),
      warning: isPast
        ? `La fecha ${params.date} ya pasó (hoy es ${today.toISODate()}). Pedí otra fecha futura.`
        : undefined,
    };
  }

  async create(input: CreateAppointmentInput) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: input.businessId },
    });

    let service: { id: string; name: string; durationMinutes: number } | null =
      null;
    if (input.serviceId) {
      service = await this.prisma.service.findFirst({
        where: {
          id: input.serviceId,
          businessId: input.businessId,
          enabled: true,
        },
        select: { id: true, name: true, durationMinutes: true },
      });
      if (!service) throw new NotFoundException('Servicio no encontrado');
    }

    const timezone = input.timezone || business.timezone;
    const startsAt = DateTime.fromJSDate(input.startsAt).setZone(timezone);
    if (!startsAt.isValid) {
      throw new BadRequestException('startsAt inválido');
    }

    const durationMinutes = service?.durationMinutes ?? 30;
    const endsAt = input.endsAt
      ? DateTime.fromJSDate(input.endsAt).setZone(timezone)
      : startsAt.plus({ minutes: durationMinutes });

    const date = startsAt.toISODate()!;
    const slots = await this.availability.getAvailableSlots({
      businessId: input.businessId,
      date,
      durationMinutes,
      timezone,
    });
    const match = slots.find(
      (slot) =>
        DateTime.fromISO(slot.startIso).toMillis() === startsAt.toMillis(),
    );
    if (!match) {
      throw new BadRequestException(
        'Ese horario no está disponible. Pedí checkAvailability primero.',
      );
    }

    const extras = await this.resolveContactExtras(input);
    const contactName = input.contactName?.trim() || extras.name || undefined;
    const contactPhone = input.contactPhone?.trim() || extras.phone || undefined;
    const contactEmail = input.contactEmail?.trim() || extras.email || undefined;

    const summary = service
      ? `${service.name} — ${contactName ?? 'Cliente'}`
      : `Cita — ${contactName ?? 'Cliente'}`;

    const googleEventId = await this.google.createEvent({
      businessId: input.businessId,
      summary,
      description: [
        contactPhone ? `Tel: ${contactPhone}` : null,
        contactEmail ? `Email: ${contactEmail}` : null,
        input.notes ?? null,
      ]
        .filter(Boolean)
        .join('\n'),
      startsAt: startsAt.toUTC().toJSDate(),
      endsAt: endsAt.toUTC().toJSDate(),
      timezone,
      attendeeEmail: contactEmail,
    });

    return this.prisma.appointment.create({
      data: {
        businessId: input.businessId,
        serviceId: service?.id,
        conversationId: input.conversationId,
        userId: input.userId,
        contactName,
        contactPhone,
        contactEmail,
        startsAt: startsAt.toUTC().toJSDate(),
        endsAt: endsAt.toUTC().toJSDate(),
        timezone,
        status: input.status ?? 'confirmed',
        googleEventId,
        notes: input.notes,
      },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
    });
  }

  async cancel(businessId: string, id: string, reason?: string) {
    const appointment = await this.get(businessId, id);
    if (appointment.status === 'cancelled') return appointment;

    if (appointment.googleEventId) {
      await this.google.deleteEvent(businessId, appointment.googleEventId);
    }

    return this.prisma.appointment.update({
      where: { id },
      data: {
        status: 'cancelled',
        notes: reason
          ? [appointment.notes, `Cancelada: ${reason}`]
              .filter(Boolean)
              .join('\n')
          : appointment.notes,
      },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
    });
  }

  async reschedule(businessId: string, id: string, startsAtInput: Date) {
    const appointment = await this.get(businessId, id);
    if (appointment.status === 'cancelled') {
      throw new BadRequestException('La cita ya está cancelada');
    }

    const timezone = appointment.timezone;
    const startsAt = DateTime.fromJSDate(startsAtInput).setZone(timezone);
    const durationMinutes = Math.max(
      5,
      Math.round(
        (appointment.endsAt.getTime() - appointment.startsAt.getTime()) /
          60_000,
      ),
    );
    const endsAt = startsAt.plus({ minutes: durationMinutes });

    const slots = await this.availability.getAvailableSlots({
      businessId,
      date: startsAt.toISODate()!,
      durationMinutes,
      timezone,
      excludeAppointmentId: id,
    });
    const match = slots.find(
      (slot) =>
        DateTime.fromISO(slot.startIso).toMillis() === startsAt.toMillis(),
    );
    if (!match) {
      throw new BadRequestException('El nuevo horario no está disponible');
    }

    if (appointment.googleEventId) {
      await this.google.updateEvent({
        businessId,
        eventId: appointment.googleEventId,
        summary: appointment.service
          ? `${appointment.service.name} — ${appointment.contactName ?? 'Cliente'}`
          : undefined,
        startsAt: startsAt.toUTC().toJSDate(),
        endsAt: endsAt.toUTC().toJSDate(),
        timezone,
      });
    }

    await this.prisma.appointmentReminderLog.deleteMany({
      where: { appointmentId: id },
    });

    return this.prisma.appointment.update({
      where: { id },
      data: {
        startsAt: startsAt.toUTC().toJSDate(),
        endsAt: endsAt.toUTC().toJSDate(),
        status: 'confirmed',
      },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
    });
  }

  async findForContact(businessId: string, phone?: string, email?: string) {
    if (!phone && !email) return [];
    return this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['pending', 'confirmed'] },
        startsAt: { gte: new Date() },
        OR: [
          ...(phone ? [{ contactPhone: phone }] : []),
          ...(email ? [{ contactEmail: email }] : []),
        ],
      },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 10,
    });
  }

  private async resolveContactExtras(input: CreateAppointmentInput): Promise<{
    name?: string;
    phone?: string;
    email?: string;
  }> {
    const [conversation, user] = await Promise.all([
      input.conversationId
        ? this.prisma.conversation.findFirst({
            where: { id: input.conversationId, businessId: input.businessId },
            select: {
              contactName: true,
              contactPhone: true,
              user: { select: { name: true, phone: true, email: true } },
            },
          })
        : null,
      input.userId
        ? this.prisma.user.findFirst({
            where: { id: input.userId, businessId: input.businessId },
            select: { name: true, phone: true, email: true },
          })
        : null,
    ]);

    return {
      name:
        conversation?.contactName ||
        conversation?.user?.name ||
        user?.name ||
        undefined,
      phone:
        conversation?.contactPhone ||
        conversation?.user?.phone ||
        user?.phone ||
        undefined,
      email: conversation?.user?.email || user?.email || undefined,
    };
  }
}
