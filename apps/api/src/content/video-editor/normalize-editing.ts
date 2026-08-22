import type { ContentStrategy } from '../content.types';
import {
  defaultCtaWindow,
  defaultHookWindow,
  resolveOverlayRange,
  sanitizeOverlayText,
} from './text-overlay';
import type {
  LogoCornerPosition,
  OverlayVerticalPosition,
  VideoEditingInstructions,
} from './video-editor.types';

const POSITIONS = new Set<OverlayVerticalPosition>(['top', 'center', 'bottom']);
const LOGO_POSITIONS = new Set<LogoCornerPosition>([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asPosition(value: unknown): OverlayVerticalPosition | undefined {
  return typeof value === 'string' &&
    POSITIONS.has(value as OverlayVerticalPosition)
    ? (value as OverlayVerticalPosition)
    : undefined;
}

function asLogoPosition(value: unknown): LogoCornerPosition | undefined {
  return typeof value === 'string' &&
    LOGO_POSITIONS.has(value as LogoCornerPosition)
    ? (value as LogoCornerPosition)
    : undefined;
}

export function normalizeVideoEditing(input: {
  strategy: ContentStrategy;
  durationSeconds: number;
  hasLogo: boolean;
}): VideoEditingInstructions {
  const duration = Math.max(1, input.durationSeconds);
  const editing = asRecord(input.strategy.editing);
  const hookText = sanitizeOverlayText(
    input.strategy.hook || input.strategy.headline,
  );
  const ctaText = sanitizeOverlayText(input.strategy.cta);
  const hookWindow = defaultHookWindow(duration);
  const ctaWindow = defaultCtaWindow(duration);

  const addHook = asBoolean(editing?.add_hook) ?? Boolean(hookText);
  const addCta = asBoolean(editing?.add_cta) ?? Boolean(ctaText);
  const addLogo =
    (asBoolean(editing?.add_logo) ?? input.hasLogo) && input.hasLogo;

  const hookRange = resolveOverlayRange(
    asNumber(editing?.hook_start),
    asNumber(editing?.hook_end),
    duration,
    hookWindow,
    0.4,
  );
  const ctaRange = resolveOverlayRange(
    asNumber(editing?.cta_start),
    asNumber(editing?.cta_end),
    duration,
    ctaWindow,
    0.32,
  );

  const requestedLogo = asLogoPosition(editing?.logo_position);
  const ctaOnBottom =
    (asPosition(editing?.cta_position) ?? 'bottom') === 'bottom';
  const logoPosition =
    requestedLogo === 'top-left'
      ? 'top-left'
      : requestedLogo === 'top-right'
        ? 'top-right'
        : ctaOnBottom || !requestedLogo
          ? 'top-right'
          : requestedLogo;

  return {
    addHook: addHook && Boolean(hookText),
    hookText,
    hookStart: hookRange.start,
    hookEnd: hookRange.end,
    hookPosition: asPosition(editing?.hook_position) ?? 'top',
    hookFontSize: asNumber(editing?.hook_font_size),
    addCta: addCta && Boolean(ctaText),
    ctaText,
    ctaStart: ctaRange.start,
    ctaEnd: ctaRange.end,
    ctaPosition: asPosition(editing?.cta_position) ?? 'bottom',
    ctaFontSize: asNumber(editing?.cta_font_size),
    addLogo,
    logoPosition,
    logoWidth: asNumber(editing?.logo_width),
    logoOpacity: asNumber(editing?.logo_opacity),
  };
}

export function hasVisibleEdits(
  instructions: VideoEditingInstructions,
): boolean {
  return instructions.addHook || instructions.addCta || instructions.addLogo;
}
