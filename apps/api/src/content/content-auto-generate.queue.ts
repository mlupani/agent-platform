export const CONTENT_AUTO_QUEUE = 'content-auto-generate';
export const CONTENT_AUTO_JOB = 'generate';

/** jobId estable por negocio (BullMQ repeatable). */
export function contentAutoJobId(businessId: string) {
  return `content-auto:${businessId}`;
}

/**
 * Luxon weekday 1=lun … 7=dom → cron DOW 0=dom, 1=lun … 6=sáb.
 * Vacío o los 7 días → `*`.
 * BullMQ usa cron de 6 campos: sec min hour dom month dow
 */
export function buildContentAutoCron(
  timeHhMm: string,
  luxonWeekdays: number[],
): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeHhMm?.trim() ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const days =
    luxonWeekdays?.length > 0
      ? [...new Set(luxonWeekdays.filter((d) => d >= 1 && d <= 7))]
      : [1, 2, 3, 4, 5, 6, 7];

  const cronDow =
    days.length === 7
      ? '*'
      : [...new Set(days.map((d) => (d === 7 ? 0 : d)))]
          .sort((a, b) => a - b)
          .join(',');

  return `0 ${minute} ${hour} * * ${cronDow}`;
}
