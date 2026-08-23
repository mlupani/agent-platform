import { Injectable } from '@nestjs/common';
import { DateTime, Interval } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { GoogleCalendarService } from './google-calendar.service';
import type { AvailableSlot, BusyInterval } from './calendar.types';

interface Occupancy {
  serviceId: string | null;
  startsAt: DateTime;
  endsAt: DateTime;
  count: number;
  capacity: number;
  remaining: number;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleCalendarService,
  ) {}

  async getAvailableSlots(params: {
    businessId: string;
    date: string;
    durationMinutes: number;
    timezone: string;
    excludeAppointmentId?: string;
    serviceId?: string;
  }): Promise<AvailableSlot[]> {
    const zone = params.timezone;
    const day = DateTime.fromISO(params.date, { zone }).startOf('day');
    if (!day.isValid) {
      throw new Error('Fecha inválida. Usá YYYY-MM-DD.');
    }

    const dayOfWeek = day.weekday - 1;
    const hours = await this.prisma.businessHour.findUnique({
      where: {
        businessId_dayOfWeek: {
          businessId: params.businessId,
          dayOfWeek,
        },
      },
    });

    if (!hours || hours.isClosed) return [];

    const ranges = this.parseRanges(hours.ranges);
    if (!ranges.length) return [];

    const openIntervals = ranges
      .map((range) => {
        const [sh, sm] = range.start.split(':').map(Number);
        const [eh, em] = range.end.split(':').map(Number);
        const start = day.set({
          hour: sh,
          minute: sm,
          second: 0,
          millisecond: 0,
        });
        const end = day.set({
          hour: eh,
          minute: em,
          second: 0,
          millisecond: 0,
        });
        return Interval.fromDateTimes(start, end);
      })
      .filter((interval) => interval.isValid);

    const dayStart = day.toUTC().toJSDate();
    const dayEnd = day.endOf('day').toUTC().toJSDate();

    const [occupancies, googleBusy, requestedService] = await Promise.all([
      this.loadOccupancies(
        params.businessId,
        day,
        dayStart,
        dayEnd,
        zone,
        params.excludeAppointmentId,
      ),
      this.google.getBusyIntervals(
        params.businessId,
        dayStart,
        dayEnd,
      ),
      params.serviceId
        ? this.prisma.service.findFirst({
            where: { id: params.serviceId, businessId: params.businessId },
            select: { id: true, capacity: true, durationMinutes: true },
          })
        : Promise.resolve(null),
    ]);

    const durationMinutes =
      requestedService?.durationMinutes ?? params.durationMinutes;
    const requestedCapacity = requestedService?.capacity ?? 1;

    const googleExternal = googleBusy.filter((item) => {
      const start = DateTime.fromJSDate(item.start, { zone: 'utc' }).setZone(
        zone,
      );
      const end = DateTime.fromJSDate(item.end, { zone: 'utc' }).setZone(zone);
      return !occupancies.some(
        (session) =>
          session.remaining > 0 &&
          Math.abs(session.startsAt.toMillis() - start.toMillis()) < 120_000 &&
          Math.abs(session.endsAt.toMillis() - end.toMillis()) < 120_000,
      );
    });

    const fullyBusy = [
      ...occupancies
        .filter((session) => session.remaining <= 0)
        .map((session) =>
          Interval.fromDateTimes(session.startsAt, session.endsAt),
        ),
      ...googleExternal.map((item) =>
        Interval.fromDateTimes(
          DateTime.fromJSDate(item.start, { zone: 'utc' }).setZone(zone),
          DateTime.fromJSDate(item.end, { zone: 'utc' }).setZone(zone),
        ),
      ),
    ];

    const free = this.subtractBusy(openIntervals, fullyBusy);
    const now = DateTime.now().setZone(zone);
    const duration = { minutes: durationMinutes };
    const starts = new Map<number, DateTime>();

    for (const interval of free) {
      let cursor = interval.start!;
      while (cursor.plus(duration) <= interval.end!) {
        if (cursor.plus(duration) > now) {
          starts.set(cursor.toMillis(), cursor);
        }
        cursor = cursor.plus(duration);
      }
    }

    for (const session of occupancies) {
      if (session.remaining <= 0) continue;
      if (
        params.serviceId &&
        session.serviceId &&
        session.serviceId !== params.serviceId
      ) {
        continue;
      }
      if (session.startsAt.plus(duration) <= now) continue;
      if (!this.containedInOpen(session.startsAt, openIntervals)) continue;
      starts.set(session.startsAt.toMillis(), session.startsAt);
    }

    const slots: AvailableSlot[] = [];
    for (const start of [...starts.values()].sort(
      (a, b) => a.toMillis() - b.toMillis(),
    )) {
      const end = start.plus(duration);
      const slot = this.evaluateSlot({
        start,
        end,
        occupancies,
        requestedServiceId: params.serviceId,
        requestedCapacity,
        now,
        openIntervals,
      });
      if (slot) slots.push(slot);
    }

    return slots;
  }

  private evaluateSlot(params: {
    start: DateTime;
    end: DateTime;
    occupancies: Occupancy[];
    requestedServiceId?: string;
    requestedCapacity: number;
    now: DateTime;
    openIntervals: Interval[];
  }): AvailableSlot | null {
    const { start, end, occupancies, requestedServiceId, requestedCapacity } =
      params;
    if (end <= params.now) return null;
    if (!this.containedInOpen(start, params.openIntervals)) return null;

    const overlapping = occupancies.filter(
      (session) => session.startsAt < end && session.endsAt > start,
    );

    if (!overlapping.length) {
      return this.toSlot(start, end, requestedCapacity, requestedCapacity, requestedServiceId);
    }

    const otherClass = overlapping.find(
      (session) =>
        session.serviceId &&
        requestedServiceId &&
        session.serviceId !== requestedServiceId,
    );
    if (otherClass) return null;

    const foreign = overlapping.find(
      (session) =>
        session.serviceId &&
        !requestedServiceId &&
        session.startsAt.toMillis() !== start.toMillis(),
    );
    if (foreign) return null;

    const sameStart = overlapping.filter(
      (session) => session.startsAt.toMillis() === start.toMillis(),
    );
    if (!sameStart.length) return null;

    const session = requestedServiceId
      ? sameStart.find((item) => item.serviceId === requestedServiceId) ??
        sameStart[0]
      : sameStart[0];

    if (session.remaining <= 0) return null;
    if (
      requestedServiceId &&
      session.serviceId &&
      session.serviceId !== requestedServiceId
    ) {
      return null;
    }

    return this.toSlot(
      start,
      end,
      session.remaining,
      session.capacity,
      session.serviceId ?? requestedServiceId,
    );
  }

  private toSlot(
    start: DateTime,
    end: DateTime,
    remaining: number,
    capacity: number,
    serviceId?: string | null,
  ): AvailableSlot {
    return {
      start: start.toFormat('HH:mm'),
      end: end.toFormat('HH:mm'),
      startIso: start.toISO()!,
      endIso: end.toISO()!,
      remaining,
      capacity,
      ...(serviceId ? { serviceId } : {}),
    };
  }

  private containedInOpen(start: DateTime, open: Interval[]): boolean {
    return open.some((interval) => interval.contains(start));
  }

  private async loadOccupancies(
    businessId: string,
    day: DateTime,
    from: Date,
    to: Date,
    zone: string,
    excludeAppointmentId?: string,
  ): Promise<Occupancy[]> {
    const dayOfWeek = day.weekday - 1;
    const [appointments, templates] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { lt: to },
          endsAt: { gt: from },
          ...(excludeAppointmentId
            ? { id: { not: excludeAppointmentId } }
            : {}),
        },
        select: {
          serviceId: true,
          startsAt: true,
          endsAt: true,
          service: { select: { capacity: true, durationMinutes: true } },
        },
      }),
      this.prisma.classTemplate.findMany({
        where: { businessId, dayOfWeek },
        include: {
          service: {
            select: {
              id: true,
              capacity: true,
              durationMinutes: true,
            },
          },
        },
      }),
    ]);

    const grouped = new Map<string, Occupancy>();
    for (const row of appointments) {
      const startsAt = DateTime.fromJSDate(row.startsAt, {
        zone: 'utc',
      }).setZone(zone);
      const endsAt = DateTime.fromJSDate(row.endsAt, { zone: 'utc' }).setZone(
        zone,
      );
      const key = `${row.serviceId ?? 'none'}|${startsAt.toUTC().toISO()}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        existing.remaining = Math.max(0, existing.capacity - existing.count);
        continue;
      }
      const capacity = row.serviceId
        ? Math.max(1, row.service?.capacity ?? 1)
        : 1;
      grouped.set(key, {
        serviceId: row.serviceId,
        startsAt,
        endsAt,
        count: 1,
        capacity,
        remaining: Math.max(0, capacity - 1),
      });
    }

    for (const template of templates) {
      const [hour, minute] = template.startTime.split(':').map(Number);
      const startsAt = day.set({
        hour,
        minute,
        second: 0,
        millisecond: 0,
      });
      const duration = template.service.durationMinutes || 30;
      const endsAt = startsAt.plus({ minutes: duration });
      const capacity = Math.max(
        1,
        template.capacity ?? template.service.capacity ?? 1,
      );
      const key = `${template.serviceId}|${startsAt.toUTC().toISO()}`;
      if (grouped.has(key)) {
        const session = grouped.get(key)!;
        session.capacity = capacity;
        session.remaining = Math.max(0, capacity - session.count);
        continue;
      }
      grouped.set(key, {
        serviceId: template.serviceId,
        startsAt,
        endsAt,
        count: 0,
        capacity,
        remaining: capacity,
      });
    }

    return [...grouped.values()];
  }

  private parseRanges(raw: unknown): Array<{ start: string; end: string }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const row = item as { start?: string; end?: string };
        if (!row.start || !row.end) return null;
        return { start: row.start, end: row.end };
      })
      .filter((item): item is { start: string; end: string } => Boolean(item));
  }

  private subtractBusy(open: Interval[], busy: Interval[]): Interval[] {
    let free = [...open];
    for (const block of busy) {
      if (!block.isValid) continue;
      const next: Interval[] = [];
      for (const slot of free) {
        next.push(...slot.difference(block));
      }
      free = next;
    }
    return free;
  }
}
