/**
 * Pure reconciliation logic: turn "what SigueFit says" + "what the platform
 * currently holds" into a list of concrete actions. No Prisma, no clock.
 */
import { DateTime } from 'luxon';
import type { PackProgress } from './parse';

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export interface BalanceStudent {
  userId: string;
  name: string;
  progress: PackProgress;
}

export interface BalancePass {
  id: string;
  userId: string;
  serviceId: string;
  sessionCount: number;
  sessionsPaid: number;
  sessionsUsed: number;
  status: string;
  createdAt: string;
}

export interface PackService {
  id: string;
  sessionCount: number;
}

export type BalanceAction =
  | {
      kind: 'create';
      userId: string;
      name: string;
      serviceId: string;
      sessionCount: number;
      sessionsPaid: number;
      sessionsUsed: number;
      status: 'ACTIVE' | 'COMPLETED';
    }
  | {
      kind: 'update';
      passId: string;
      userId: string;
      name: string;
      serviceId: string;
      sessionCount: number;
      sessionsPaid: number;
      sessionsUsed: number;
      status: 'ACTIVE' | 'COMPLETED';
      prevUsed: number;
    }
  | { kind: 'retire'; passId: string; userId: string; name: string };

export function planBalances(input: {
  students: BalanceStudent[];
  passes: BalancePass[];
  services: PackService[];
}): { actions: BalanceAction[]; issues: string[] } {
  const actions: BalanceAction[] = [];
  const issues: string[] = [];

  const passesByUser = new Map<string, BalancePass[]>();
  for (const pass of input.passes) {
    const list = passesByUser.get(pass.userId) ?? [];
    list.push(pass);
    passesByUser.set(pass.userId, list);
  }

  for (const student of input.students) {
    const size = student.progress.size;
    const used = Math.max(0, Math.min(student.progress.taken, size));
    const status: 'ACTIVE' | 'COMPLETED' =
      used >= size ? 'COMPLETED' : 'ACTIVE';

    const service = input.services.find((s) => s.sessionCount === size);
    if (!service) {
      issues.push(
        `Falta el servicio "Pack ${size}" — cargalo en Servicios y volvé a correr (${student.name}).`,
      );
      continue;
    }

    const userPasses = [...(passesByUser.get(student.userId) ?? [])].sort(
      (a, b) =>
        rankActive(b) - rankActive(a) || b.createdAt.localeCompare(a.createdAt),
    );

    if (userPasses.length === 0) {
      actions.push({
        kind: 'create',
        userId: student.userId,
        name: student.name,
        serviceId: service.id,
        sessionCount: size,
        sessionsPaid: size,
        sessionsUsed: used,
        status,
      });
      continue;
    }

    const [primary, ...extras] = userPasses;
    for (const extra of extras) {
      if (
        extra.status !== 'COMPLETED' ||
        extra.sessionsUsed < extra.sessionsPaid
      ) {
        actions.push({
          kind: 'retire',
          passId: extra.id,
          userId: student.userId,
          name: student.name,
        });
      }
    }

    const alreadyRight =
      primary.serviceId === service.id &&
      primary.sessionCount === size &&
      primary.sessionsPaid === size &&
      primary.sessionsUsed === used &&
      primary.status === status;
    if (alreadyRight) continue;

    actions.push({
      kind: 'update',
      passId: primary.id,
      userId: student.userId,
      name: student.name,
      serviceId: service.id,
      sessionCount: size,
      sessionsPaid: size,
      sessionsUsed: used,
      status,
      prevUsed: primary.sessionsUsed,
    });
  }

  return { actions, issues };
}

const rankActive = (pass: BalancePass): number =>
  pass.status === 'ACTIVE' ? 1 : 0;

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface DesiredSlot {
  userId: string;
  name: string;
  startsAtUTC: string;
}

export interface CurrentAppointment {
  id: string;
  userId: string | null;
  startsAtUTC: string;
  status: string;
}

export interface RosterTemplate {
  /** 0 = Monday … 6 = Sunday, matching ClassTemplate.dayOfWeek. */
  dayOfWeek: number;
  startTime: string;
  serviceId: string;
  durationMinutes: number;
  capacity: number;
}

export interface RosterCreate {
  userId: string;
  name: string;
  startsAtUTC: string;
  endsAtUTC: string;
  serviceId: string;
}

export interface RosterCancel {
  appointmentId: string;
  userId: string | null;
  name: string | null;
  startsAtUTC: string;
}

const ACTIVE_STATUSES = new Set(['pending', 'confirmed']);
const SETTLED_STATUSES = new Set(['completed', 'no_show']);

export function planRoster(input: {
  desired: DesiredSlot[];
  current: CurrentAppointment[];
  templates: RosterTemplate[];
  timezone: string;
  now: string;
}): { toCreate: RosterCreate[]; toCancel: RosterCancel[]; issues: string[] } {
  const nowMs = DateTime.fromISO(input.now, { zone: 'utc' }).toMillis();
  const issues: string[] = [];

  const templateAt = new Map<string, RosterTemplate>();
  for (const tpl of input.templates) {
    templateAt.set(`${tpl.dayOfWeek}|${tpl.startTime}`, tpl);
  }

  const isFuture = (iso: string): boolean =>
    DateTime.fromISO(iso, { zone: 'utc' }).toMillis() > nowMs;

  const keyOf = (userId: string | null, iso: string): string =>
    `${userId ?? '?'}|${normIso(iso)}`;

  // De-dupe desired and keep only future slots.
  const desired = new Map<string, DesiredSlot>();
  for (const slot of input.desired) {
    if (!isFuture(slot.startsAtUTC)) continue;
    desired.set(keyOf(slot.userId, slot.startsAtUTC), slot);
  }

  const currentActive = input.current.filter((a) =>
    ACTIVE_STATUSES.has(a.status),
  );
  const currentSettled = input.current.filter((a) =>
    SETTLED_STATUSES.has(a.status),
  );
  const alreadyThere = new Set<string>([
    ...currentActive.map((a) => keyOf(a.userId, a.startsAtUTC)),
    ...currentSettled.map((a) => keyOf(a.userId, a.startsAtUTC)),
  ]);

  // Seats already taken per slot instant.
  const seatsUsed = new Map<string, number>();
  for (const appt of currentActive) {
    const k = normIso(appt.startsAtUTC);
    seatsUsed.set(k, (seatsUsed.get(k) ?? 0) + 1);
  }

  const toCreate: RosterCreate[] = [];
  for (const slot of [...desired.values()].sort(sortByStartThenName)) {
    if (alreadyThere.has(keyOf(slot.userId, slot.startsAtUTC))) continue;

    const local = DateTime.fromISO(slot.startsAtUTC, { zone: 'utc' }).setZone(
      input.timezone,
    );
    const dow = local.weekday - 1;
    const hhmm = local.toFormat('HH:mm');
    const tpl = templateAt.get(`${dow}|${hhmm}`);
    if (!tpl) {
      issues.push(
        `Sin horario en la grilla para ${formatSlot(slot.startsAtUTC, input.timezone)} (${slot.name}) — agregalo en "Horarios de clase".`,
      );
      continue;
    }

    const k = normIso(slot.startsAtUTC);
    const taken = seatsUsed.get(k) ?? 0;
    if (taken >= tpl.capacity) {
      issues.push(
        `Clase ${formatSlot(slot.startsAtUTC, input.timezone)} llena (cupo ${tpl.capacity}) — ${slot.name} queda afuera.`,
      );
      continue;
    }
    seatsUsed.set(k, taken + 1);

    toCreate.push({
      userId: slot.userId,
      name: slot.name,
      startsAtUTC: slot.startsAtUTC,
      endsAtUTC: local.plus({ minutes: tpl.durationMinutes }).toUTC().toISO()!,
      serviceId: tpl.serviceId,
    });
  }

  const desiredKeys = new Set([...desired.keys()]);
  const toCancel: RosterCancel[] = currentActive
    .filter(
      (a) =>
        isFuture(a.startsAtUTC) &&
        !desiredKeys.has(keyOf(a.userId, a.startsAtUTC)),
    )
    .map((a) => ({
      appointmentId: a.id,
      userId: a.userId,
      name: null,
      startsAtUTC: a.startsAtUTC,
    }))
    .sort((x, y) => x.startsAtUTC.localeCompare(y.startsAtUTC));

  return { toCreate, toCancel, issues };
}

function normIso(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).toISO({
    suppressMilliseconds: false,
  })!;
}

function sortByStartThenName(a: DesiredSlot, b: DesiredSlot): number {
  return (
    a.startsAtUTC.localeCompare(b.startsAtUTC) ||
    a.name.localeCompare(b.name, 'es')
  );
}

export function formatSlot(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('es')
    .toFormat('ccc dd/MM HH:mm');
}
