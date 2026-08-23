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
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
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

  async listClasses(businessId: string, from: string, to: string) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const zone = business.timezone;
    const fromDt = DateTime.fromISO(from, { setZone: true }).setZone(zone);
    const toDt = DateTime.fromISO(to, { setZone: true }).setZone(zone);
    const rangeStart = fromDt.toUTC().toJSDate();
    const rangeEnd = toDt.toUTC().toJSDate();

    const [appointments, templates] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: rangeStart, lt: rangeEnd },
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              capacity: true,
            },
          },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.classTemplate.findMany({
        where: { businessId },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              capacity: true,
            },
          },
        },
      }),
    ]);

    const sessions = new Map<
      string,
      {
        id: string;
        date: string;
        start: string;
        startsAt: string;
        endsAt: string;
        dayOfWeek: number;
        service: {
          id: string;
          name: string;
          durationMinutes: number;
          capacity: number;
        } | null;
        capacity: number;
        booked: number;
        remaining: number;
        templateId: string | null;
        attendees: Array<{
          id: string;
          contactName: string | null;
          contactPhone: string | null;
          contactEmail: string | null;
          userId: string | null;
          status: string;
          notes: string | null;
        }>;
      }
    >();

    const keyOf = (serviceId: string | null, startsAt: DateTime) =>
      `${serviceId ?? 'none'}|${startsAt.toUTC().toISO()}`;

    for (const row of appointments) {
      const startsAt = DateTime.fromJSDate(row.startsAt, {
        zone: 'utc',
      }).setZone(zone);
      const endsAt = DateTime.fromJSDate(row.endsAt, { zone: 'utc' }).setZone(
        zone,
      );
      const key = keyOf(row.serviceId, startsAt);
      const existing = sessions.get(key);
      const attendee = {
        id: row.id,
        contactName: row.contactName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        userId: row.userId,
        status: row.status,
        notes: row.notes,
      };
      if (existing) {
        existing.attendees.push(attendee);
        existing.booked += 1;
        existing.remaining = Math.max(0, existing.capacity - existing.booked);
        continue;
      }
      const capacity = Math.max(1, row.service?.capacity ?? 1);
      sessions.set(key, {
        id: key,
        date: startsAt.toISODate()!,
        start: startsAt.toFormat('HH:mm'),
        startsAt: startsAt.toISO()!,
        endsAt: endsAt.toISO()!,
        dayOfWeek: startsAt.weekday - 1,
        service: row.service
          ? {
              id: row.service.id,
              name: row.service.name,
              durationMinutes: row.service.durationMinutes,
              capacity: row.service.capacity,
            }
          : null,
        capacity,
        booked: 1,
        remaining: Math.max(0, capacity - 1),
        templateId: null,
        attendees: [attendee],
      });
    }

    for (
      let cursor = fromDt.startOf('day');
      cursor < toDt;
      cursor = cursor.plus({ days: 1 })
    ) {
      const dayOfWeek = cursor.weekday - 1;
      for (const template of templates.filter(
        (item) => item.dayOfWeek === dayOfWeek,
      )) {
        const [hour, minute] = template.startTime.split(':').map(Number);
        const startsAt = cursor.set({
          hour,
          minute,
          second: 0,
          millisecond: 0,
        });
        const endsAt = startsAt.plus({
          minutes: template.service.durationMinutes,
        });
        const capacity = Math.max(
          1,
          template.capacity ?? template.service.capacity ?? 1,
        );
        const key = keyOf(template.serviceId, startsAt);
        const existing = sessions.get(key);
        if (existing) {
          existing.templateId = template.id;
          existing.capacity = capacity;
          existing.remaining = Math.max(0, capacity - existing.booked);
          continue;
        }
        sessions.set(key, {
          id: key,
          date: startsAt.toISODate()!,
          start: startsAt.toFormat('HH:mm'),
          startsAt: startsAt.toISO()!,
          endsAt: endsAt.toISO()!,
          dayOfWeek,
          service: {
            id: template.service.id,
            name: template.service.name,
            durationMinutes: template.service.durationMinutes,
            capacity: template.service.capacity,
          },
          capacity,
          booked: 0,
          remaining: capacity,
          templateId: template.id,
          attendees: [],
        });
      }
    }

    return {
      timezone: zone,
      sessions: [...sessions.values()].sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      ),
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
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
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
      serviceId: params.serviceId,
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
        select: { id: true, name: true, durationMinutes: true, capacity: true },
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
      serviceId: service?.id,
    });
    const match = slots.find(
      (slot) =>
        DateTime.fromISO(slot.startIso).toMillis() === startsAt.toMillis(),
    );
    if (!match) {
      const canJoin = await this.canJoinClass({
        businessId: input.businessId,
        serviceId: service?.id,
        startsAt,
        endsAt,
        timezone,
      });
      if (!canJoin) {
        throw new BadRequestException(
          'Ese horario no está disponible. Pedí checkAvailability primero.',
        );
      }
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
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
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
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
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
      serviceId: appointment.serviceId ?? undefined,
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
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
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
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 10,
    });
  }

  private async canJoinClass(params: {
    businessId: string;
    serviceId?: string;
    startsAt: DateTime;
    endsAt: DateTime;
    timezone: string;
  }): Promise<boolean> {
    if (!params.serviceId) return false;
    const dayOfWeek = params.startsAt.weekday - 1;
    const startTime = params.startsAt.toFormat('HH:mm');
    const from = params.startsAt.toUTC().toJSDate();
    const to = params.endsAt.toUTC().toJSDate();

    const [overlapping, template, service] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          businessId: params.businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { lt: to },
          endsAt: { gt: from },
        },
        select: { serviceId: true, startsAt: true },
      }),
      this.prisma.classTemplate.findFirst({
        where: {
          businessId: params.businessId,
          serviceId: params.serviceId,
          dayOfWeek,
          startTime,
        },
      }),
      this.prisma.service.findFirst({
        where: { id: params.serviceId, businessId: params.businessId },
        select: { capacity: true },
      }),
    ]);

    const otherClass = overlapping.some(
      (row) => row.serviceId && row.serviceId !== params.serviceId,
    );
    if (otherClass) return false;

    const sameStart = overlapping.filter(
      (row) =>
        DateTime.fromJSDate(row.startsAt, { zone: 'utc' })
          .setZone(params.timezone)
          .toMillis() === params.startsAt.toMillis(),
    );
    if (
      overlapping.length &&
      sameStart.length !== overlapping.length &&
      !sameStart.length
    ) {
      return false;
    }

    const capacity = Math.max(
      1,
      template?.capacity ?? service?.capacity ?? 1,
    );
    return sameStart.length < capacity;
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
