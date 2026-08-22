export const REMINDER_CHANNELS = ['whatsapp', 'email', 'instagram'] as const;

export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const DEFAULT_REMINDER_HOURS = 24;
export const REMINDER_MIN_HOURS = 1;
export const REMINDER_MAX_HOURS = 24;
export const REMINDER_GRACE_MINUTES = 30;

export const DEFAULT_REMINDER_MESSAGE =
  'Hola {{nombre}}, te recordamos tu cita{{servicio}} el {{fecha}} a las {{hora}}. Si necesitás cambiarla, respondé este mensaje.';

export function clampReminderHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_REMINDER_HOURS;
  return Math.min(
    REMINDER_MAX_HOURS,
    Math.max(REMINDER_MIN_HOURS, Math.round(n)),
  );
}

export function normalizeReminderChannels(value: unknown): ReminderChannel[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<ReminderChannel>();
  const ordered: ReminderChannel[] = [];
  for (const item of raw) {
    if (item !== 'whatsapp' && item !== 'email' && item !== 'instagram') {
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    ordered.push(item);
  }
  return ordered.length ? ordered : [...REMINDER_CHANNELS];
}

export function normalizeReminderPhone(value?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

export function normalizeReminderEmail(value?: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? '';
  return email.includes('@') ? email : null;
}

export interface ReminderDueWindow {
  from: Date;
  to: Date;
}

/** Citas cuyo recordatorio vence ahora: startsAt ∈ (now + hours − grace, now + hours]. */
export function reminderDueWindow(
  now: Date,
  hoursBefore: number,
  graceMinutes = REMINDER_GRACE_MINUTES,
): ReminderDueWindow {
  const hours = clampReminderHours(hoursBefore);
  const to = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const from = new Date(to.getTime() - graceMinutes * 60 * 1000);
  return { from, to };
}

export function isReminderDue(input: {
  startsAt: Date;
  now: Date;
  hoursBefore: number;
  graceMinutes?: number;
}): boolean {
  if (input.startsAt.getTime() <= input.now.getTime()) return false;
  const { from, to } = reminderDueWindow(
    input.now,
    input.hoursBefore,
    input.graceMinutes,
  );
  const t = input.startsAt.getTime();
  return t > from.getTime() && t <= to.getTime();
}

export interface ReminderChannelAvailability {
  whatsappReady: boolean;
  emailReady: boolean;
  instagramReady: boolean;
  phone: string | null;
  email: string | null;
  instagramThread: boolean;
}

export function pickReminderChannel(
  channels: ReminderChannel[],
  availability: ReminderChannelAvailability,
): ReminderChannel | null {
  for (const channel of channels) {
    if (channel === 'whatsapp' && availability.whatsappReady && availability.phone) {
      return 'whatsapp';
    }
    if (channel === 'email' && availability.emailReady && availability.email) {
      return 'email';
    }
    if (
      channel === 'instagram' &&
      availability.instagramReady &&
      availability.instagramThread
    ) {
      return 'instagram';
    }
  }
  return null;
}

export interface ReminderTemplateVars {
  nombre: string;
  servicio: string;
  fecha: string;
  hora: string;
  negocio: string;
}

export function renderReminderMessage(
  template: string | null | undefined,
  vars: ReminderTemplateVars,
): string {
  const source = template?.trim() || DEFAULT_REMINDER_MESSAGE;
  return source
    .replaceAll('{{nombre}}', vars.nombre)
    .replaceAll('{{servicio}}', vars.servicio)
    .replaceAll('{{fecha}}', vars.fecha)
    .replaceAll('{{hora}}', vars.hora)
    .replaceAll('{{negocio}}', vars.negocio);
}

export function reminderServiceClause(serviceName?: string | null): string {
  const name = serviceName?.trim();
  return name ? ` de ${name}` : '';
}
