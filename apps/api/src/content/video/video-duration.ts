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

const GEMINI_OMNI_DURATIONS = [4, 6, 8, 10] as const;

/**
 * Seedance 2: 4–15s. Seedance 1.5 Pro: 4–12s. Kling 2.6: 5 o 10. Kling 3.x: 3–15s.
 * Gemini Omni: 4 | 6 | 8 | 10 (el panel manda 5/10/15).
 */
export function clampDurationForKie(model: string, seconds: number): number {
  const m = model.toLowerCase();
  if (/seedance-2/i.test(m))
    return Math.min(15, Math.max(4, Math.round(seconds)));
  if (m.includes('seedance'))
    return Math.min(12, Math.max(4, Math.round(seconds)));
  if (/kling-2\.6/i.test(m)) return Math.round(seconds) <= 5 ? 5 : 10;
  if (m.includes('kling'))
    return Math.min(15, Math.max(3, Math.round(seconds)));
  if (/gemini-omni/i.test(m)) {
    const n = Math.round(seconds);
    let best: number = GEMINI_OMNI_DURATIONS[0];
    let dist = Number.POSITIVE_INFINITY;
    for (const option of GEMINI_OMNI_DURATIONS) {
      const delta = Math.abs(option - n);
      if (delta < dist) {
        dist = delta;
        best = option;
      }
    }
    return best;
  }
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

const VEO_DURATIONS = [4, 6, 8] as const;
export type VeoDurationSeconds = (typeof VEO_DURATIONS)[number];

/** Veo 3.1 Lite: solo 4, 6 u 8 segundos. El panel manda 5/10/15. */
export function clampDurationForVeo(seconds: number): VeoDurationSeconds {
  if (seconds === 5) return 4;
  if (seconds === 10 || seconds === 15) return 8;
  if (seconds === 4 || seconds === 6 || seconds === 8) return seconds;

  let best: VeoDurationSeconds = 4;
  let dist = Number.POSITIVE_INFINITY;
  for (const option of VEO_DURATIONS) {
    const delta = Math.abs(option - seconds);
    if (delta < dist) {
      dist = delta;
      best = option;
    }
  }
  return best;
}
