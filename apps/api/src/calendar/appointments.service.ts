import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadConversionService } from '../leads/lead-conversion.service';
import { AvailabilityService } from './availability.service';
import { GoogleCalendarService } from './google-calendar.service';
import { PackBalanceService } from '../packs/pack-balance.service';
import type { CreateAppointmentInput } from './calendar.types';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly google: GoogleCalendarService,
    private readonly conversions: LeadConversionService,
    private readonly packs: PackBalanceService,
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
        userId: (item as any).userId as string | null,
        isTrial: (item as any).isTrial as boolean | undefined,
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

    const keyOf = (startsAt: DateTime) => startsAt.toUTC().toISO()!;

    for (const row of appointments) {
      const startsAt = DateTime.fromJSDate(row.startsAt, {
        zone: 'utc',
      }).setZone(zone);
      const endsAt = DateTime.fromJSDate(row.endsAt, { zone: 'utc' }).setZone(
        zone,
      );
      const key = keyOf(startsAt);
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
        service: null,
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
        const key = keyOf(startsAt);
        const existing = sessions.get(key);
        if (existing) {
          existing.templateId = template.id;
          existing.capacity = Math.max(existing.capacity, capacity);
          existing.remaining = Math.max(0, existing.capacity - existing.booked);
          continue;
        }
        sessions.set(key, {
          id: key,
          date: startsAt.toISODate()!,
          start: startsAt.toFormat('HH:mm'),
          startsAt: startsAt.toISO()!,
          endsAt: endsAt.toISO()!,
          dayOfWeek,
          service: null,
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

    // Validación de saldo / trial antes de crear
    if (input.isTrial) {
      // Verificar que no haya usado prueba ya
      let trialUser: any = null;
      if (input.userId) {
        trialUser = await this.prisma.user.findFirst({
          where: { id: input.userId, businessId: input.businessId },
          select: { hasUsedTrial: true },
        });
      } else if (input.contactPhone) {
        const phoneDigits = input.contactPhone.replace(/\D/g, '').slice(-8);
        trialUser = await this.prisma.user.findFirst({
          where: { businessId: input.businessId, phone: { contains: phoneDigits } },
          select: { hasUsedTrial: true, id: true },
        });
        // también chequear appointments isTrial previos por teléfono
        if (!trialUser) {
          const prevTrial = await this.prisma.appointment.findFirst({
            where: { businessId: input.businessId, contactPhone: { contains: phoneDigits }, isTrial: true },
          });
          if (prevTrial) throw new BadRequestException('Ya utilizaste tu clase de prueba. Para continuar necesitás contratar un pack.');
        }
      }
      if (trialUser?.hasUsedTrial) {
        throw new BadRequestException('Ya utilizaste tu clase de prueba. Para continuar necesitás contratar un pack.');
      }
      const prevTrialByUser = input.userId
        ? await this.prisma.appointment.findFirst({ where: { businessId: input.businessId, userId: input.userId, isTrial: true } })
        : null;
      if (prevTrialByUser) throw new BadRequestException('Ya utilizaste tu clase de prueba.');
    } else {
      // Validar saldo si es alumno identificado
      let balanceUserId: string | null = input.userId || null;
      if (!balanceUserId && input.contactPhone) {
        const phoneDigits = input.contactPhone.replace(/\D/g, '').slice(-8);
        const u = await this.prisma.user.findFirst({
          where: { businessId: input.businessId, phone: { contains: phoneDigits } },
          select: { id: true },
        });
        if (u) balanceUserId = u.id;
      }
      if (balanceUserId) {
        try {
          const balance = await this.packs.getBalance(input.businessId, balanceUserId);
          if (!balance.hasAvailableClasses) {
            throw new BadRequestException(
              'No tenés clases disponibles en tu pack. Renovás tu pack para poder reservar. Consultá a la profesora.',
            );
          }
        } catch (e: any) {
          if (e.message?.includes('No tenés clases disponibles')) throw e;
          // si alumno no tiene packs pero es INACTIVE, también bloquear con mensaje
          // si es error "Alumno no encontrado", ignorar (prospect)
        }
      }
    }

    const timezone = input.timezone || business.timezone;
    const startsAt = DateTime.fromJSDate(input.startsAt).setZone(timezone);
    if (!startsAt.isValid) {
      throw new BadRequestException('startsAt inválido');
    }

    // Spots son por horario, no por servicio: para prueba sin servicio no hace falta buscar servicio específico
    // La disponibilidad y el cupo se chequean por horario, packs 4 y 8 comparten el mismo spot

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

    const resolvedUserId = input.userId || (await this.resolveUserIdForContact(input));

    const created = await this.prisma.appointment.create({
      data: {
        businessId: input.businessId,
        serviceId: service?.id,
        conversationId: input.conversationId,
        userId: resolvedUserId || input.userId,
        servicePassId: null,
        isTrial: input.isTrial ?? false,
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

    if ((created.status ?? 'confirmed') === 'confirmed') {
      await this.conversions.maybeConvertFromSignal({
        businessId: input.businessId,
        userId: input.userId,
        conversationId: input.conversationId,
        trigger: 'appointment.confirmed',
      });
    }

    return created;
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
    const dayOfWeek = params.startsAt.weekday - 1;
    const startTime = params.startsAt.toFormat('HH:mm');
    const from = params.startsAt.toUTC().toJSDate();
    const to = params.endsAt.toUTC().toJSDate();

    const [overlapping, template] = await Promise.all([
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
          dayOfWeek,
          startTime,
        },
      }),
    ]);

    if (!template) return false;

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

    const capacity = Math.max(1, template.capacity ?? 1);
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

  private async resolveUserIdForContact(input: CreateAppointmentInput): Promise<string | null> {
    if (input.userId) return input.userId;
    const phone = input.contactPhone?.replace(/\D/g, '').slice(-8);
    if (phone) {
      const u = await this.prisma.user.findFirst({
        where: { businessId: input.businessId, phone: { contains: phone } },
        select: { id: true },
      });
      if (u) return u.id;
    }
    if (input.contactEmail) {
      const u = await this.prisma.user.findFirst({
        where: { businessId: input.businessId, email: input.contactEmail.trim().toLowerCase() },
        select: { id: true },
      });
      if (u) return u.id;
    }
    if (input.conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: input.conversationId, businessId: input.businessId },
        select: { userId: true },
      });
      if (conv?.userId) return conv.userId;
    }
    return null;
  }

  async complete(businessId: string, appointmentId: string) {
    const appointment = await this.get(businessId, appointmentId);
    if (appointment.status === 'completed') return appointment;
    if (appointment.status === 'cancelled') throw new BadRequestException('Cita cancelada no se puede completar');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'completed' },
      include: { service: { select: { id: true, name: true, durationMinutes: true, capacity: true } } },
    });

    const userId = updated.userId || (await this.resolveUserIdForContact({ businessId, contactPhone: updated.contactPhone ?? undefined, contactEmail: updated.contactEmail ?? undefined } as CreateAppointmentInput));

    if (updated.isTrial) {
      if (userId) {
        await this.prisma.user.update({ where: { id: userId }, data: { hasUsedTrial: true } });
      }
      // trial no consume pack
      return updated;
    }

    if (userId) {
      try {
        await this.packs.consumeCredit({ businessId, userId, appointmentId: updated.id });
      } catch (e: any) {
        // si no tiene saldo, no fallar el completado pero loggear
        // lanzamos para que admin vea error, pero no revertimos status
        throw new BadRequestException(e.message || 'No se pudo consumir crédito');
      }
    }

    return this.prisma.appointment.findFirstOrThrow({
      where: { id: appointmentId },
      include: { service: { select: { id: true, name: true, durationMinutes: true, capacity: true } } },
    });
  }

  async completeById(businessId: string, id: string) {
    return this.complete(businessId, id);
  }
}
