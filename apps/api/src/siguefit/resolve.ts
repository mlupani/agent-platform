/** Glue between parsed rows + name matches and the reconcile inputs. Pure. */
import { DateTime } from 'luxon';
import type { TurnoRow, YMD, HM } from './parse';
import type { BalanceStudent, DesiredSlot } from './reconcile';

export interface ResolvedRow {
  userId: string;
  name: string;
  row: TurnoRow;
}

export function slotToUTC(date: YMD, time: HM, timezone: string): string {
  return DateTime.fromObject(
    {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: time.hour,
      minute: time.minute,
    },
    { zone: timezone },
  )
    .toUTC()
    .toISO({ suppressMilliseconds: false })!;
}

const dateKey = (d: YMD): string =>
  `${d.year}${String(d.month).padStart(2, '0')}${String(d.day).padStart(2, '0')}`;

export function latestProgressByStudent(rows: ResolvedRow[]): BalanceStudent[] {
  const best = new Map<
    string,
    { name: string; key: string; taken: number; size: number }
  >();

  for (const { userId, name, row } of rows) {
    if (!row.progress || !row.date) continue;
    const key = dateKey(row.date);
    const current = best.get(userId);
    if (
      !current ||
      key > current.key ||
      (key === current.key && row.progress.taken > current.taken)
    ) {
      best.set(userId, {
        name,
        key,
        taken: row.progress.taken,
        size: row.progress.size,
      });
    }
  }

  return [...best.entries()].map(([userId, v]) => ({
    userId,
    name: v.name,
    progress: { taken: v.taken, size: v.size },
  }));
}

export function buildDesiredSlots(
  rows: ResolvedRow[],
  timezone: string,
): DesiredSlot[] {
  const byKey = new Map<string, DesiredSlot>();
  for (const { userId, name, row } of rows) {
    if (!row.date || !row.time) continue;
    const startsAtUTC = slotToUTC(row.date, row.time, timezone);
    byKey.set(`${userId}|${startsAtUTC}`, { userId, name, startsAtUTC });
  }
  return [...byKey.values()];
}
