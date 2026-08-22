import { Injectable } from '@nestjs/common';
import { DateTime, Interval } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { GoogleCalendarService } from './google-calendar.service';
import type { AvailableSlot, BusyInterval } from './calendar.types';

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
  }): Promise<AvailableSlot[]> {
    const zone = params.timezone;
    const day = DateTime.fromISO(params.date, { zone }).startOf('day');
    if (!day.isValid) {
      throw new Error('Fecha inválida. Usá YYYY-MM-DD.');
    }

    // Luxon: 1=Mon … 7=Sun → nuestro schema: 0=Mon … 6=Sun
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

    const localBusy = await this.localBusy(
      params.businessId,
      dayStart,
      dayEnd,
      params.excludeAppointmentId,
    );
    const googleBusy = await this.google.getBusyIntervals(
      params.businessId,
      dayStart,
      dayEnd,
    );
    const busy = [...localBusy, ...googleBusy].map((item) =>
      Interval.fromDateTimes(
        DateTime.fromJSDate(item.start, { zone: 'utc' }).setZone(zone),
        DateTime.fromJSDate(item.end, { zone: 'utc' }).setZone(zone),
      ),
    );

    const free = this.subtractBusy(openIntervals, busy);
    const slots: AvailableSlot[] = [];
    const duration = { minutes: params.durationMinutes };
    const now = DateTime.now().setZone(zone);

    for (const interval of free) {
      let cursor = interval.start!;
      while (cursor.plus(duration) <= interval.end!) {
        const end = cursor.plus(duration);
        if (end > now) {
          slots.push({
            start: cursor.toFormat('HH:mm'),
            end: end.toFormat('HH:mm'),
            startIso: cursor.toISO(),
            endIso: end.toISO(),
          });
        }
        cursor = cursor.plus(duration);
      }
    }

    return slots;
  }

  private async localBusy(
    businessId: string,
    from: Date,
    to: Date,
    excludeAppointmentId?: string,
  ): Promise<BusyInterval[]> {
    const rows = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['pending', 'confirmed'] },
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    });
    return rows.map((row) => ({ start: row.startsAt, end: row.endsAt }));
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
