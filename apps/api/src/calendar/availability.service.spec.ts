import { DateTime } from 'luxon';
import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
  const prisma = {
    businessHour: { findUnique: jest.fn() },
    appointment: { findMany: jest.fn() },
  };
  const google = {
    getBusyIntervals: jest.fn().mockResolvedValue([]),
  };

  const service = new AvailabilityService(prisma as never, google as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty when day is closed', async () => {
    prisma.businessHour.findUnique.mockResolvedValue({
      isClosed: true,
      ranges: [],
    });

    const slots = await service.getAvailableSlots({
      businessId: 'biz-1',
      date: '2026-08-16', // domingo
      durationMinutes: 30,
      timezone: 'America/Argentina/Buenos_Aires',
    });

    expect(slots).toEqual([]);
  });

  it('generates slots inside open ranges and skips local busy', async () => {
    prisma.businessHour.findUnique.mockResolvedValue({
      isClosed: false,
      ranges: [{ start: '09:00', end: '11:00' }],
    });

    const zone = 'America/Argentina/Buenos_Aires';
    const busyStart = DateTime.fromISO('2027-03-08T09:00:00', { zone });
    const busyEnd = busyStart.plus({ minutes: 30 });
    prisma.appointment.findMany.mockResolvedValue([
      {
        startsAt: busyStart.toUTC().toJSDate(),
        endsAt: busyEnd.toUTC().toJSDate(),
      },
    ]);

    const slots = await service.getAvailableSlots({
      businessId: 'biz-1',
      date: '2027-03-08', // lunes futuro
      durationMinutes: 30,
      timezone: zone,
    });

    expect(slots.map((s) => s.start)).toEqual(['09:30', '10:00', '10:30']);
    expect(google.getBusyIntervals).toHaveBeenCalled();
  });

  it('merges google busy intervals', async () => {
    prisma.businessHour.findUnique.mockResolvedValue({
      isClosed: false,
      ranges: [{ start: '10:00', end: '11:00' }],
    });
    prisma.appointment.findMany.mockResolvedValue([]);

    const zone = 'America/Argentina/Buenos_Aires';
    const start = DateTime.fromISO('2027-03-09T10:00:00', { zone });
    google.getBusyIntervals.mockResolvedValue([
      {
        start: start.toUTC().toJSDate(),
        end: start.plus({ minutes: 30 }).toUTC().toJSDate(),
      },
    ]);

    const slots = await service.getAvailableSlots({
      businessId: 'biz-1',
      date: '2027-03-09',
      durationMinutes: 30,
      timezone: zone,
    });

    expect(slots.map((s) => s.start)).toEqual(['10:30']);
  });
});
