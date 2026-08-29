import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadConversionService } from '../leads/lead-conversion.service';
import { AvailabilityService } from './availability.service';
import { GoogleCalendarService } from './google-calendar.service';
import { PackBalanceService } from '../packs/pack-balance.service';
import { AdminNotifyService } from '../notifications/admin-notify.service';
import type { CreateAppointmentInput } from './calendar.types';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly google: GoogleCalendarService,
    private readonly conversions: LeadConversionService,
    private readonly packs: PackBalanceService,
    private readonly adminNotify: AdminNotifyService,
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

    const userIdsForFeed = [...new Set(local.map((i) => (i as any).userId).filter(Boolean) as string[])];
    const progressForFeed = await this.getPackProgressMap(businessId, userIdsForFeed);

    const localItems = local
      .filter((item) => item.status !== 'cancelled')
      .map((item) => {
        const isTrial = !!(item as any).isTrial;
        const contactLabel = item.contactName || item.contactPhone || 'Alumna';
        const progress = item.userId ? progressForFeed.get(item.userId) ?? null : null;
        const title = this.buildAppointmentTitle(contactLabel, isTrial, progress, item.service?.name);
        return {
          id: item.id,
          source: 'local' as const,
          title,
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
          isTrial: isTrial as boolean | undefined,
          classLabel: isTrial ? 'clase de prueba' : progress ? `clase ${progress.display}` : null,
          packProgress: progress,
        };
      });

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
          // incluir completed/no_show para que sigan visibles en calendario con check verde/rojo
          status: { in: ['pending', 'confirmed', 'completed', 'no_show'] },
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
          isTrial?: boolean | null;
          classLabel?: string | null;
          packProgress?: { total: number; used: number; remaining: number; display: string; packName: string | null } | null;
        }>;
      }
    >();

    const keyOf = (startsAt: DateTime) => startsAt.toUTC().toISO()!;

    const userIdsForProgress = [...new Set(appointments.map((a) => (a as any).userId).filter(Boolean) as string[])];
    const progressMap = await this.getPackProgressMap(businessId, userIdsForProgress);

    for (const row of appointments) {
      const startsAt = DateTime.fromJSDate(row.startsAt, {
        zone: 'utc',
      }).setZone(zone);
      const endsAt = DateTime.fromJSDate(row.endsAt, { zone: 'utc' }).setZone(
        zone,
      );
      const key = keyOf(startsAt);
      const existing = sessions.get(key);
      const isTrial = !!(row as any).isTrial;
      const prog = row.userId ? progressMap.get(row.userId) ?? null : null;
      const classLabel = isTrial ? 'clase de prueba' : prog ? `clase ${prog.display}` : null;
      const attendee = {
        id: row.id,
        contactName: row.contactName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        userId: row.userId,
        status: row.status,
        notes: row.notes,
        isTrial,
        classLabel,
        packProgress: prog,
      };
      if (existing) {
        existing.attendees.push(attendee);
        existing.booked += 1;
        existing.remaining = Math.max(0, existing.capacity - existing.booked);
        if (!existing.service && row.service) {
          existing.service = {
            id: row.service.id,
            name: row.service.name,
            durationMinutes: row.service.durationMinutes,
            capacity: row.service.capacity,
          };
        }
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
        const key = keyOf(startsAt);
        const existing = sessions.get(key);
        if (existing) {
          existing.templateId = template.id;
          existing.capacity = Math.max(existing.capacity, capacity);
          existing.remaining = Math.max(0, existing.capacity - existing.booked);
          if (!existing.service && template.service) {
            existing.service = {
              id: template.service.id,
              name: template.service.name,
              durationMinutes: template.service.durationMinutes,
              capacity: template.service.capacity,
            };
          }
          continue;
        }
        sessions.set(key, {
          id: key,
          date: startsAt.toISODate()!,
          start: startsAt.toFormat('HH:mm'),
          startsAt: startsAt.toISO()!,
          endsAt: endsAt.toISO()!,
          dayOfWeek,
          service: template.service
            ? {
                id: template.service.id,
                name: template.service.name,
                durationMinutes: template.service.durationMinutes,
                capacity: template.service.capacity,
              }
            : null,
          capacity,
          booked: 0,
          remaining: capacity,
          templateId: template.id,
          attendees: [],
        });
      }
    }

    const byName = (a: { contactName: string | null; contactPhone: string | null }, b: { contactName: string | null; contactPhone: string | null }) =>
      (a.contactName || a.contactPhone || '').localeCompare(
        b.contactName || b.contactPhone || '',
        'es',
        { sensitivity: 'base' },
      );
    for (const session of sessions.values()) {
      session.attendees.sort(byName);
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
    // si isTrial viene explícito, validar que no haya usado
    let effectiveIsTrial = !!input.isTrial;
    if (effectiveIsTrial) {
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
    }
    // propagar effectiveIsTrial al input para el resto del flujo
    (input as any).effectiveIsTrial = effectiveIsTrial;

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

    const effectiveIsTrialForSummary = (input as any).effectiveIsTrial ?? !!input.isTrial;
    let summaryProgress: { display: string } | null = null;
    if (!effectiveIsTrialForSummary) {
      const summaryUserId = input.userId || null;
      if (summaryUserId) {
        summaryProgress = await this.getPackProgressMap(input.businessId, [summaryUserId]).then((m) => m.get(summaryUserId) ?? null);
      }
    }
    const summary = effectiveIsTrialForSummary
      ? `${contactName ?? 'Alumna'} — clase de prueba`
      : summaryProgress
        ? `${contactName ?? 'Alumna'} — clase ${summaryProgress.display}`
        : service
          ? `${contactName ?? 'Alumna'} — ${service.name}`
          : `Cita — ${contactName ?? 'Alumna'}`;

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

    const finalIsTrial = effectiveIsTrialForSummary;
    const created = await this.prisma.appointment.create({
      data: {
        businessId: input.businessId,
        serviceId: service?.id,
        conversationId: input.conversationId,
        userId: resolvedUserId || input.userId,
        servicePassId: null,
        isTrial: finalIsTrial,
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

    void this.adminNotify.notifyAppointmentCreated(created);

    if ((created.status ?? 'confirmed') === 'confirmed') {
      await this.conversions.maybeConvertFromSignal({
        businessId: input.businessId,
        userId: input.userId,
        conversationId: input.conversationId,
        trigger: 'appointment.confirmed',
      });
    }

    // Si la clase ya terminó (registro a horario pasado) contabilizar asistencia inmediata
    // en lugar de esperar al cron de 5 min, para que el test sea instantáneo.
    const now = new Date();
    if (created.endsAt.getTime() <= now.getTime() && created.status !== 'completed' && created.status !== 'cancelled' && created.status !== 'no_show') {
      try {
        return await this.complete(input.businessId, created.id);
      } catch (e) {
        // si falla por falta de crédito, queda como completed igual (ver autoCompletePast)
        this.logger.warn(`create past auto-complete falló ${created.id}: ${e instanceof Error ? e.message : 'unknown'}`);
        return this.get(input.businessId, created.id);
      }
    }

    return created;
  }

  async cancel(businessId: string, id: string, reason?: string) {
    const appointment = await this.get(businessId, id);
    if (appointment.status === 'cancelled') return appointment;

    if (appointment.googleEventId) {
      await this.google.deleteEvent(businessId, appointment.googleEventId);
    }

    // Si la cita ya estaba completada y consumió un pack, devolver el crédito
    if (
      appointment.status === 'completed' &&
      (appointment as any).servicePassId &&
      (appointment as any).userId
    ) {
      const servicePassId = (appointment as any).servicePassId as string;
      const userId = (appointment as any).userId as string;
      try {
        await this.prisma.$transaction(async (tx) => {
          const pass = await tx.servicePass.findUnique({
            where: { id: servicePassId },
          });
          if (pass && pass.sessionsUsed > 0) {
            await tx.servicePass.update({
              where: { id: pass.id },
              data: {
                sessionsUsed: { decrement: 1 },
                status: 'ACTIVE',
              },
            });
            await tx.classCreditMovement.create({
              data: {
                businessId,
                userId,
                servicePassId: pass.id,
                appointmentId: appointment.id,
                type: 'REFUND',
                amount: 1,
                reason: reason
                  ? `Devolución por cancelación: ${reason}`
                  : 'Devolución por cancelación/borrado del calendario',
              },
            });
          }
          await tx.appointment.update({
            where: { id },
            data: {
              status: 'cancelled',
              servicePassId: null,
              notes: reason
                ? [appointment.notes, `Cancelada: ${reason}`]
                    .filter(Boolean)
                    .join('\n')
                : appointment.notes,
            },
          });
        });
        const refunded = await this.get(businessId, id);
        void this.adminNotify.notifyAppointmentCancelled(refunded);
        return refunded;
      } catch (error) {
        this.logger.warn(
          `Refund falló para cita ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        // fallback: al menos cancelar la cita
      }
    }

    const cancelled = await this.prisma.appointment.update({
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
    void this.adminNotify.notifyAppointmentCancelled(cancelled);
    return cancelled;
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

    const previousStartsAt = appointment.startsAt;
    const updated = await this.prisma.appointment.update({
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
    void this.adminNotify.notifyAppointmentRescheduled({
      ...updated,
      previousStartsAt,
    });
    return updated;
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
        this.logger.warn(`consumeCredit sin saldo ${updated.id} user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
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

  async markAttendance(
    businessId: string,
    id: string,
    attended: boolean,
  ) {
    const appointment = await this.get(businessId, id);
    if (appointment.status === 'cancelled') {
      throw new BadRequestException('La cita está cancelada');
    }

    if (attended) {
      // Marcar como asistió -> completed + consumir pack si corresponde
      if (appointment.status === 'completed') {
        // asegurar consumo si faltó (idempotente)
        const userId =
          (appointment as any).userId || appointment.contactPhone
            ? await this.resolveUserIdForContact({
                businessId,
                contactPhone: appointment.contactPhone ?? undefined,
                contactEmail: appointment.contactEmail ?? undefined,
              } as any)
            : null;
        const effectiveUserId = (appointment as any).userId || userId;
        if (
          effectiveUserId &&
          !(appointment as any).servicePassId &&
          !appointment.isTrial
        ) {
          try {
            // forzar estado completed para que consumeCredit lo permita
            await this.prisma.appointment.update({
              where: { id },
              data: { status: 'completed' },
            });
            await this.packs.consumeCredit({
              businessId,
              userId: effectiveUserId,
              appointmentId: id,
            });
          } catch (e) {
            this.logger.warn(
              `markAttendance consume falló ${id}: ${e instanceof Error ? e.message : 'unknown'}`,
            );
          }
        }
        return this.get(businessId, id);
      }
      // si era no_show, volver a completed y consumir
      if (appointment.status === 'no_show') {
        await this.prisma.appointment.update({
          where: { id },
          data: { status: 'completed' },
        });
        const userId =
          (appointment as any).userId ||
          (await this.resolveUserIdForContact({
            businessId,
            contactPhone: appointment.contactPhone ?? undefined,
            contactEmail: appointment.contactEmail ?? undefined,
          } as any));
        const effectiveUserId = (appointment as any).userId || userId;
        if (effectiveUserId && !appointment.isTrial) {
          try {
            await this.packs.consumeCredit({
              businessId,
              userId: effectiveUserId,
              appointmentId: id,
            });
          } catch (e) {
            this.logger.warn(
              `markAttendance re-consume falló ${id}: ${e instanceof Error ? e.message : 'unknown'}`,
            );
            // aunque falle por falta de crédito, dejamos en completed
          }
        }
        return this.get(businessId, id);
      }
      // pending/confirmed -> completar normal
      return this.complete(businessId, id);
    } else {
      // Marcar como faltó -> no_show + refund si estaba completed
      if (appointment.status === 'no_show') return appointment;
      if (
        appointment.status === 'completed' &&
        (appointment as any).servicePassId &&
        (appointment as any).userId
      ) {
        const servicePassId = (appointment as any).servicePassId as string;
        const userId = (appointment as any).userId as string;
        await this.prisma.$transaction(async (tx) => {
          const pass = await tx.servicePass.findUnique({
            where: { id: servicePassId },
          });
          if (pass && pass.sessionsUsed > 0) {
            await tx.servicePass.update({
              where: { id: pass.id },
              data: { sessionsUsed: { decrement: 1 }, status: 'ACTIVE' },
            });
            await tx.classCreditMovement.create({
              data: {
                businessId,
                userId,
                servicePassId: pass.id,
                appointmentId: id,
                type: 'REFUND',
                amount: 1,
                reason: 'Falta a clase — devolución automática',
              },
            });
          }
          await tx.appointment.update({
            where: { id },
            data: { status: 'no_show', servicePassId: null },
          });
        });
        return this.get(businessId, id);
      }
      // pending/confirmed sin consumo -> solo pasar a no_show
      await this.prisma.appointment.update({
        where: { id },
        data: { status: 'no_show', servicePassId: null },
      });
      return this.get(businessId, id);
    }
  }

  private async isTrialEligible(businessId: string, userId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, businessId }, select: { hasUsedTrial: true } });
    if (user?.hasUsedTrial) return false;
    const prev = await this.prisma.appointment.findFirst({ where: { businessId, userId, isTrial: true }, select: { id: true } });
    if (prev) return false;
    return true;
  }

  private async getPackProgressMap(
    businessId: string,
    userIds: string[],
  ): Promise<Map<string, { total: number; used: number; remaining: number; display: string; packName: string | null }>> {
    const map = new Map<string, { total: number; used: number; remaining: number; display: string; packName: string | null }>();
    if (!userIds.length) return map;
    if (!(this.prisma as any).servicePass?.findMany) return map;
    const passes = await (this.prisma as any).servicePass.findMany({
      where: { businessId, userId: { in: userIds } },
      include: { service: { select: { name: true } } },
    });
    const grouped = new Map<string, typeof passes>();
    for (const p of passes) {
      const list = grouped.get(p.userId) ?? [];
      list.push(p);
      grouped.set(p.userId, list);
    }
    for (const uid of userIds) {
      const list = grouped.get(uid) ?? [];
      if (!list.length) continue;
      const total = list.reduce((acc: number, p: any) => acc + p.sessionsPaid, 0);
      const used = list.reduce((acc: number, p: any) => acc + p.sessionsUsed, 0);
      const remaining = Math.max(0, total - used);
      if (total <= 0) continue;
      // ordenar para obtener pack principal (activo más antiguo)
      const sorted = [...list].sort((a, b) => {
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      const primary = sorted[0];
      const next = remaining > 0 ? Math.min(used + 1, total) : used;
      // display como 2/4 ; si total es suma de packs mostrar suma, pero preferir primary size si hay uno dominante
      const displayTotal = total;
      const display = `${next}/${displayTotal}`;
      map.set(uid, { total, used, remaining, display, packName: primary?.service?.name ?? null });
    }
    return map;
  }

  async replicateWeek(
    businessId: string,
    params: {
      sourceFrom: string;
      sourceTo: string;
      targetFrom: string;
      dryRun?: boolean;
      includeTrials?: boolean;
    },
  ): Promise<{
    businessId: string;
    sourceFrom: string;
    sourceTo: string;
    targetFrom: string;
    dryRun: boolean;
    totalSource: number;
    toCreate: number;
    skippedDuplicate: number;
    skippedFull: number;
    skippedNoTemplate: number;
    created: number;
    items: Array<{
      sourceId: string;
      contactName: string | null;
      sourceStartsAt: string;
      targetStartsAt: string;
      targetEndsAt: string;
      status: 'will_create' | 'skipped_duplicate' | 'skipped_full' | 'skipped_no_template' | 'created' | 'error';
      reason?: string;
    }>;
    errors: Array<{ sourceId: string; message: string }>;
  }> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const zone = business.timezone || 'America/Argentina/Buenos_Aires';

    const parse = (value: string, label: string): DateTime => {
      if (!value) throw new BadRequestException(`${label} es requerido`);
      // accept YYYY-MM-DD as date in business timezone
      let dt: DateTime;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        dt = DateTime.fromISO(value.trim(), { zone }).startOf('day');
      } else {
        dt = DateTime.fromISO(value.trim(), { setZone: true });
        if (dt.isValid) dt = dt.setZone(zone);
      }
      if (!dt.isValid) throw new BadRequestException(`${label} inválido: ${value}`);
      return dt;
    };

    const sourceFromDT = parse(params.sourceFrom, 'sourceFrom');
    const sourceToDT = parse(params.sourceTo, 'sourceTo');
    const targetFromDT = parse(params.targetFrom, 'targetFrom');
    if (sourceFromDT >= sourceToDT) throw new BadRequestException('sourceFrom debe ser menor que sourceTo');
    const dryRun = !!params.dryRun;
    const includeTrials = params.includeTrials !== false;

    const sourceStartDay = sourceFromDT.setZone(zone).startOf('day');
    const targetStartDay = targetFromDT.setZone(zone).startOf('day');

    // source appointments
    const sourceApps = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['pending', 'confirmed', 'completed'] },
        startsAt: { gte: sourceFromDT.toUTC().toJSDate(), lt: sourceToDT.toUTC().toJSDate() },
        ...(includeTrials ? {} : { isTrial: false }),
      },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true, capacity: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });

    // range for target
    const sourceDurationDays = Math.max(1, Math.ceil(sourceToDT.diff(sourceFromDT, 'days').days));
    const targetToDay = targetStartDay.plus({ days: sourceDurationDays });
    const targetRangeStartUTC = targetStartDay.toUTC().toJSDate();
    const targetRangeEndUTC = targetToDay.toUTC().toJSDate();

    const [targetExisting, templates] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed', 'completed'] },
          startsAt: { gte: targetRangeStartUTC, lt: targetRangeEndUTC },
        },
        select: { id: true, startsAt: true, userId: true, contactPhone: true, contactEmail: true },
      }),
      this.prisma.classTemplate.findMany({
        where: { businessId },
        include: { service: { select: { id: true, capacity: true, durationMinutes: true } } },
      }),
    ]);

    const templateByKey = new Map<string, (typeof templates)[number]>();
    for (const t of templates) templateByKey.set(`${t.dayOfWeek}-${t.startTime}`, t);

    const existingCountBySlot = new Map<number, number>();
    for (const row of targetExisting) {
      const key = row.startsAt.getTime();
      existingCountBySlot.set(key, (existingCountBySlot.get(key) ?? 0) + 1);
    }

    const pendingCountBySlot = new Map<number, number>();
    const items: Array<{
      sourceId: string;
      contactName: string | null;
      sourceStartsAt: string;
      targetStartsAt: string;
      targetEndsAt: string;
      status: 'will_create' | 'skipped_duplicate' | 'skipped_full' | 'skipped_no_template' | 'created' | 'error';
      reason?: string;
    }> = [];
    const errors: Array<{ sourceId: string; message: string }> = [];
    let toCreate = 0;
    let skippedDuplicate = 0;
    let skippedFull = 0;
    let skippedNoTemplate = 0;

    type Planned = { source: (typeof sourceApps)[number]; targetStartUTC: Date; targetEndUTC: Date; targetStartZone: DateTime };
    const planned: Planned[] = [];

    for (const app of sourceApps) {
      const srcStartZone = DateTime.fromJSDate(app.startsAt, { zone: 'utc' }).setZone(zone);
      const daysOffset = Math.floor(srcStartZone.startOf('day').diff(sourceStartDay, 'days').days);
      const targetStartZone = targetStartDay
        .plus({ days: daysOffset })
        .set({ hour: srcStartZone.hour, minute: srcStartZone.minute, second: 0, millisecond: 0 });
      const durationMs = app.endsAt.getTime() - app.startsAt.getTime();
      const targetEndZone = targetStartZone.plus({ milliseconds: durationMs });
      const targetStartUTC = targetStartZone.toUTC().toJSDate();
      const targetEndUTC = targetEndZone.toUTC().toJSDate();

      const dayOfWeek = targetStartZone.weekday - 1;
      const startTime = targetStartZone.toFormat('HH:mm');
      const tmpl = templateByKey.get(`${dayOfWeek}-${startTime}`);
      // Si no hay template para ese horario y no hay servicio, lo omitimos (horario cerrado)
      // pero si hay servicio asociado lo permitimos aunque no haya template (clase extra)
      if (!tmpl && !app.serviceId) {
        skippedNoTemplate++;
        items.push({
          sourceId: app.id,
          contactName: app.contactName,
          sourceStartsAt: app.startsAt.toISOString(),
          targetStartsAt: targetStartUTC.toISOString(),
          targetEndsAt: targetEndUTC.toISOString(),
          status: 'skipped_no_template',
          reason: `Sin horario modelo para ${startTime} del día ${dayOfWeek}`,
        });
        continue;
      }
      const capacity = tmpl ? Math.max(1, tmpl.capacity ?? tmpl.service.capacity ?? app.service?.capacity ?? 5) : Math.max(1, app.service?.capacity ?? 5);
      const slotKey = targetStartUTC.getTime();
      const existingCount = existingCountBySlot.get(slotKey) ?? 0;
      const pendingForSlot = pendingCountBySlot.get(slotKey) ?? 0;
      if (existingCount + pendingForSlot >= capacity) {
        skippedFull++;
        items.push({
          sourceId: app.id,
          contactName: app.contactName,
          sourceStartsAt: app.startsAt.toISOString(),
          targetStartsAt: targetStartUTC.toISOString(),
          targetEndsAt: targetEndUTC.toISOString(),
          status: 'skipped_full',
          reason: `Clase llena ${existingCount + pendingForSlot}/${capacity}`,
        });
        continue;
      }
      // duplicate check: same person at same slot
      const isDuplicate = targetExisting.some(
        (row) =>
          row.startsAt.getTime() === slotKey &&
          ((row.userId && app.userId && row.userId === app.userId) ||
            (row.contactPhone && app.contactPhone && row.contactPhone.replace(/\D/g, '').slice(-8) === app.contactPhone.replace(/\D/g, '').slice(-8))),
      );
      // also check among already planned for same slot+person
      const alreadyPlannedDuplicate = planned.some(
        (p) =>
          p.targetStartUTC.getTime() === slotKey &&
          ((p.source.userId && app.userId && p.source.userId === app.userId) ||
            (p.source.contactPhone && app.contactPhone && p.source.contactPhone.replace(/\D/g, '').slice(-8) === app.contactPhone.replace(/\D/g, '').slice(-8))),
      );
      if (isDuplicate || alreadyPlannedDuplicate) {
        skippedDuplicate++;
        items.push({
          sourceId: app.id,
          contactName: app.contactName,
          sourceStartsAt: app.startsAt.toISOString(),
          targetStartsAt: targetStartUTC.toISOString(),
          targetEndsAt: targetEndUTC.toISOString(),
          status: 'skipped_duplicate',
          reason: 'Ya anotada en ese horario',
        });
        continue;
      }

      toCreate++;
      pendingCountBySlot.set(slotKey, pendingForSlot + 1);
      planned.push({ source: app, targetStartUTC, targetEndUTC, targetStartZone });
      items.push({
        sourceId: app.id,
        contactName: app.contactName,
        sourceStartsAt: app.startsAt.toISOString(),
        targetStartsAt: targetStartUTC.toISOString(),
        targetEndsAt: targetEndUTC.toISOString(),
        status: dryRun ? 'will_create' : 'will_create',
      });
    }

    let created = 0;
    if (!dryRun) {
      for (const p of planned) {
        const app = p.source;
        try {
          // Resolve userId for contact if missing (keep original)
          const createdRow = await this.prisma.appointment.create({
            data: {
              businessId,
              serviceId: app.serviceId,
              userId: app.userId,
              contactName: app.contactName,
              contactPhone: app.contactPhone,
              contactEmail: app.contactEmail,
              startsAt: p.targetStartUTC,
              endsAt: p.targetEndUTC,
              timezone: zone,
              status: 'confirmed',
              isTrial: !!(app as any).isTrial,
              notes: app.notes,
            },
          });
          // try google sync best-effort
          try {
            const summary = this.buildAppointmentTitle(
              app.contactName || app.contactPhone || 'Alumna',
              !!(app as any).isTrial,
              null,
              app.service?.name,
            );
            const googleId = await this.google.createEvent({
              businessId,
              summary,
              description: [
                app.contactPhone ? `Tel: ${app.contactPhone}` : null,
                app.contactEmail ? `Email: ${app.contactEmail}` : null,
                app.notes ?? null,
              ]
                .filter(Boolean)
                .join('\n'),
              startsAt: p.targetStartUTC,
              endsAt: p.targetEndUTC,
              timezone: zone,
              attendeeEmail: app.contactEmail ?? undefined,
            });
            if (googleId) {
              await this.prisma.appointment.update({ where: { id: createdRow.id }, data: { googleEventId: googleId } });
            }
          } catch (e) {
            this.logger.warn(`replicate google sync failed ${createdRow.id}: ${e instanceof Error ? e.message : 'unknown'}`);
          }
          created++;
          const idx = items.findIndex((it) => it.sourceId === app.id && it.status === 'will_create');
          if (idx >= 0) items[idx].status = 'created';
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push({ sourceId: app.id, message: msg });
          const idx = items.findIndex((it) => it.sourceId === app.id && it.status === 'will_create');
          if (idx >= 0) {
            items[idx].status = 'error';
            items[idx].reason = msg;
          }
        }
      }
      // update counts for response: toCreate stays as planned, created as actual
    }

    return {
      businessId,
      sourceFrom: sourceFromDT.toISO()!,
      sourceTo: sourceToDT.toISO()!,
      targetFrom: targetStartDay.toISODate()!,
      dryRun,
      totalSource: sourceApps.length,
      toCreate,
      skippedDuplicate,
      skippedFull,
      skippedNoTemplate,
      created,
      items,
      errors,
    };
  }

  private buildAppointmentTitle(contactLabel: string, isTrial: boolean, progress: { display: string } | null, serviceName?: string | null): string {
    if (isTrial) return `${contactLabel} — clase de prueba`;
    if (progress) return `${contactLabel} — clase ${progress.display}`;
    if (serviceName) return `${contactLabel} — ${serviceName}`;
    return `${contactLabel} — clase`;
  }

  /** Cron: completa automáticamente clases que ya terminaron y descuenta del pack. */
  async autoCompletePast(now = new Date()): Promise<number> {
    const due = await this.prisma.appointment.findMany({
      where: {
        status: { in: ['pending', 'confirmed'] },
        endsAt: { lte: now },
      },
      select: { id: true, businessId: true, startsAt: true, endsAt: true },
      orderBy: { endsAt: 'asc' },
      take: 200,
    });

    if (!due.length) return 0;

    let completed = 0;
    for (const row of due) {
      try {
        await this.complete(row.businessId, row.id);
        completed += 1;
      } catch (error) {
        // Si es falta de crédito u otro error de negocio, igual marcamos como completada si no se pudo descontar?
        // complete() ya deja la cita en 'completed' antes de consumir; si consume falla lanza pero cita quedó completed.
        // Para no reintentar infinito, si el error fue por falta de crédito, lo consideramos completado igual y logueamos.
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('sin clases disponibles') || msg.includes('No tenés clases')) {
          this.logger.warn(`Auto-complete ${row.id} sin crédito: ${msg}`);
          completed += 1;
        } else {
          this.logger.warn(`Auto-complete falló ${row.id}: ${msg}`);
        }
      }
    }
    return completed;
  }
}
