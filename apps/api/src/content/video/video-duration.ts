export const VIDEO_DURATION_OPTIONS = [5, 10, 15] as const;
export type VideoDurationSeconds = (typeof VIDEO_DURATION_OPTIONS)[number];

export function parseVideoDuration(
  value: unknown,
  fallback: VideoDurationSeconds = 5,
): VideoDurationSeconds {
  const n = Number(value);
  if (n === 5 || n === 10 || n === 15) return n;
  return fallback;
}

/** Seedance 1.5 Pro: 4–12s. Kling 3.x: 3–15s. */
export function clampDurationForKie(model: string, seconds: number): number {
  const m = model.toLowerCase();
  if (m.includes('seedance')) return Math.min(12, Math.max(4, Math.round(seconds)));
  if (m.includes('kling')) return Math.min(15, Math.max(3, Math.round(seconds)));
  return Math.min(15, Math.max(4, Math.round(seconds)));
}

/** Kling v1 standard/pro: 5 | 10. O3 / v3 / Seedance: 3–15. */
export function clampDurationForFal(model: string, seconds: number): number {
  const m = model.toLowerCase();
  if (/kling-video\/v1\//.test(m)) {
    return seconds <= 5 ? 5 : 10;
  }
  return Math.min(15, Math.max(3, Math.round(seconds)));
}
