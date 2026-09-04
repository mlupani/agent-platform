import {
  slotToUTC,
  latestProgressByStudent,
  buildDesiredSlots,
} from './resolve';
import type { TurnoRow } from './parse';

const tz = 'America/Argentina/Buenos_Aires';

describe('slotToUTC', () => {
  it('reads a wall-clock slot in the business timezone as a UTC instant', () => {
    expect(
      slotToUTC({ year: 2026, month: 9, day: 2 }, { hour: 9, minute: 0 }, tz),
    ).toBe('2026-09-02T12:00:00.000Z');
  });
});

const row = (over: Partial<TurnoRow>): TurnoRow => ({
  rawName: 'Ana',
  date: { year: 2026, month: 9, day: 1 },
  time: { hour: 9, minute: 0 },
  progress: null,
  absent: false,
  rawComment: '',
  ...over,
});

describe('latestProgressByStudent', () => {
  it('keeps the progress from each student latest dated turno', () => {
    const rows = [
      {
        userId: 'u1',
        name: 'Ana',
        row: row({
          date: { year: 2026, month: 8, day: 25 },
          progress: { taken: 2, size: 8 },
        }),
      },
      {
        userId: 'u1',
        name: 'Ana',
        row: row({
          date: { year: 2026, month: 9, day: 1 },
          progress: { taken: 3, size: 8 },
        }),
      },
    ];
    expect(latestProgressByStudent(rows)).toEqual([
      { userId: 'u1', name: 'Ana', progress: { taken: 3, size: 8 } },
    ]);
  });

  it('ignores turnos with no X/Y note', () => {
    const rows = [
      {
        userId: 'u1',
        name: 'Ana',
        row: row({ date: { year: 2026, month: 9, day: 2 }, progress: null }),
      },
      {
        userId: 'u1',
        name: 'Ana',
        row: row({
          date: { year: 2026, month: 9, day: 1 },
          progress: { taken: 3, size: 8 },
        }),
      },
    ];
    expect(latestProgressByStudent(rows)).toEqual([
      { userId: 'u1', name: 'Ana', progress: { taken: 3, size: 8 } },
    ]);
  });

  it('drops students who never had an X/Y note', () => {
    const rows = [{ userId: 'u1', name: 'Ana', row: row({ progress: null }) }];
    expect(latestProgressByStudent(rows)).toEqual([]);
  });
});

describe('buildDesiredSlots', () => {
  it('turns dated+timed rows for matched students into UTC slots', () => {
    const rows = [
      {
        userId: 'u1',
        name: 'Ana',
        row: row({
          date: { year: 2026, month: 9, day: 2 },
          time: { hour: 9, minute: 0 },
        }),
      },
      {
        userId: 'u2',
        name: 'Bea',
        row: row({ date: { year: 2026, month: 9, day: 2 }, time: null }),
      },
    ];
    expect(buildDesiredSlots(rows, tz)).toEqual([
      { userId: 'u1', name: 'Ana', startsAtUTC: '2026-09-02T12:00:00.000Z' },
    ]);
  });

  it('de-duplicates the same student in the same slot', () => {
    const rows = [
      {
        userId: 'u1',
        name: 'Ana',
        row: row({
          date: { year: 2026, month: 9, day: 2 },
          time: { hour: 9, minute: 0 },
        }),
      },
      {
        userId: 'u1',
        name: 'Ana',
        row: row({
          date: { year: 2026, month: 9, day: 2 },
          time: { hour: 9, minute: 0 },
        }),
      },
    ];
    expect(buildDesiredSlots(rows, tz)).toHaveLength(1);
  });
});
