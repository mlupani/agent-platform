const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function sanitizeOverlayText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(EMOJI_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function wrapOverlayText(
  text: string,
  maxCharsPerLine: number,
  maxLines = 3,
): string {
  return wrapOverlayLines(text, maxCharsPerLine, maxLines).join('\n');
}

export function wrapOverlayLines(
  text: string,
  maxCharsPerLine: number,
  maxLines?: number,
): string[] {
  const limit = Math.max(8, maxCharsPerLine);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > limit ? word.slice(0, limit) : word;
  }
  if (current) lines.push(current);
  if (maxLines != null) return lines.slice(0, Math.max(1, maxLines));
  return lines;
}

const GLYPH_WIDTH = 0.62;

export function measureLineWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * GLYPH_WIDTH);
}

export function fitOverlayText(input: {
  text: string;
  boxWidth: number;
  preferredFontSize: number;
  minFontSize?: number;
  maxLines?: number;
}): { text: string; fontSize: number; lineCount: number } {
  const cleaned = input.text.replace(/\s+/g, ' ').trim();
  const minSize = Math.max(12, input.minFontSize ?? 16);
  const preferred = Math.max(minSize, Math.round(input.preferredFontSize));
  const maxLines = Math.max(1, input.maxLines ?? 2);
  const boxWidth = Math.max(80, input.boxWidth);

  if (!cleaned) {
    return { text: '', fontSize: preferred, lineCount: 0 };
  }

  const fits = (lines: string[], size: number) =>
    lines.length > 0 &&
    lines.length <= maxLines &&
    lines.every((line) => measureLineWidth(line, size) <= boxWidth);

  for (let size = preferred; size >= minSize; size -= 1) {
    if (measureLineWidth(cleaned, size) <= boxWidth) {
      return { text: cleaned, fontSize: size, lineCount: 1 };
    }
  }

  for (let size = preferred; size >= minSize; size -= 1) {
    const chars = Math.max(8, Math.floor(boxWidth / (size * GLYPH_WIDTH)));
    const lines = wrapOverlayLines(cleaned, chars);
    if (fits(lines, size)) {
      return {
        text: lines.join('\n'),
        fontSize: size,
        lineCount: lines.length,
      };
    }
  }

  const chars = Math.max(8, Math.floor(boxWidth / (minSize * GLYPH_WIDTH)));
  const lines = wrapOverlayLines(cleaned, chars, maxLines);
  return {
    text: lines.join('\n'),
    fontSize: minSize,
    lineCount: Math.max(1, lines.length),
  };
}

export function charsPerLine(
  width: number,
  fontSize: number,
  sideMargin: number,
): number {
  const usable = Math.max(120, width - sideMargin * 2);
  return Math.max(10, Math.floor(usable / (fontSize * 0.58)));
}

export function clampTimeRange(
  start: number,
  end: number,
  durationSeconds: number,
): { start: number; end: number } | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const safeStart = Math.max(0, Number.isFinite(start) ? start : 0);
  const safeEnd = Math.min(
    durationSeconds,
    Number.isFinite(end) ? end : durationSeconds,
  );
  if (safeEnd - safeStart < 0.2) return null;
  return {
    start: Number(safeStart.toFixed(2)),
    end: Number(safeEnd.toFixed(2)),
  };
}

export function defaultHookWindow(durationSeconds: number): {
  start: number;
  end: number;
} {
  return {
    start: 0,
    end: Math.min(durationSeconds, Math.max(3, durationSeconds * 0.55)),
  };
}

export function defaultCtaWindow(durationSeconds: number): {
  start: number;
  end: number;
} {
  return {
    start: Math.max(0, durationSeconds * 0.42),
    end: durationSeconds,
  };
}

export function resolveOverlayRange(
  start: number | undefined,
  end: number | undefined,
  durationSeconds: number,
  fallback: { start: number; end: number },
  minShare = 0.35,
): { start: number; end: number } {
  const requested = clampTimeRange(
    start ?? fallback.start,
    end ?? fallback.end,
    durationSeconds,
  );
  const minSpan = Math.max(1.6, durationSeconds * minShare);
  if (requested && requested.end - requested.start >= minSpan) {
    return requested;
  }
  return (
    clampTimeRange(fallback.start, fallback.end, durationSeconds) ?? {
      start: 0,
      end: durationSeconds,
    }
  );
}

export function normalizeHashtag(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, '');
  if (!cleaned) return null;
  const withHash = cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
  if (withHash.length < 2 || withHash.length > 40) return null;
  return withHash;
}

export function normalizeHashtags(values: string[] | undefined): string[] {
  const unique = new Set<string>();
  for (const value of values ?? []) {
    const tag = normalizeHashtag(value);
    if (tag) unique.add(tag);
  }
  return [...unique].slice(0, 5);
}
