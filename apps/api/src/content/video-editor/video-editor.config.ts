import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ConfigService } from '@nestjs/config';

export interface VideoEditorSettings {
  enabled: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  fontFile: string | null;
  tmpDir: string;
  targetWidth: number;
  targetHeight: number;
  safeMarginTop: number;
  safeMarginBottom: number;
  safeMarginSide: number;
  hookFontSize: number;
  ctaFontSize: number;
  logoWidth: number;
  logoOpacity: number;
  barHeightRatio: number;
  timeoutMs: number;
  durationToleranceSeconds: number;
  emojiFontFile: string | null;
}

const FONT_CANDIDATES = [
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/arial.ttf',
];

const EMOJI_FONT_CANDIDATES = [
  'C:/Windows/Fonts/seguiemj.ttf',
  'C:/Windows/Fonts/seguisym.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf',
];

function envBool(
  config: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const raw = config.get<string>(key);
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envInt(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  const parsed = raw != null && raw !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  const parsed = raw != null && raw !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function targetSizeFromResolution(resolution: string | undefined): {
  width: number;
  height: number;
} {
  const value = (resolution ?? '720p').trim().toLowerCase();
  if (value === '1080p') return { width: 1080, height: 1920 };
  if (value === '480p') return { width: 480, height: 854 };
  return { width: 720, height: 1280 };
}

export function resolveBinary(
  configured: string | undefined,
  fallback: string,
): string {
  const explicit = configured?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  return fallback;
}

export function resolveFontFile(configured?: string | null): string | null {
  const explicit = configured?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return explicit || null;
}

export function resolveEmojiFontFile(configured?: string | null): string | null {
  const explicit = configured?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of EMOJI_FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadVideoEditorSettings(
  config: ConfigService,
): VideoEditorSettings {
  const defaults = targetSizeFromResolution(
    config.get<string>('VIDEO_RESOLUTION'),
  );
  return {
    enabled: envBool(config, 'VIDEO_EDITOR_ENABLED', true),
    ffmpegPath: resolveBinary(
      config.get<string>('VIDEO_EDITOR_FFMPEG_PATH'),
      'ffmpeg',
    ),
    ffprobePath: resolveBinary(
      config.get<string>('VIDEO_EDITOR_FFPROBE_PATH'),
      'ffprobe',
    ),
    fontFile: resolveFontFile(config.get<string>('VIDEO_EDITOR_FONT_FILE')),
    tmpDir: config.get<string>('VIDEO_EDITOR_TMP_DIR')?.trim() || tmpdir(),
    targetWidth: envInt(config, 'VIDEO_EDITOR_TARGET_WIDTH', defaults.width),
    targetHeight: envInt(config, 'VIDEO_EDITOR_TARGET_HEIGHT', defaults.height),
    safeMarginTop: envInt(config, 'VIDEO_EDITOR_SAFE_MARGIN_TOP', 140),
    safeMarginBottom: envInt(config, 'VIDEO_EDITOR_SAFE_MARGIN_BOTTOM', 220),
    safeMarginSide: envInt(config, 'VIDEO_EDITOR_SAFE_MARGIN_SIDE', 48),
    hookFontSize: envInt(config, 'VIDEO_EDITOR_HOOK_FONT_SIZE', 48),
    ctaFontSize: envInt(config, 'VIDEO_EDITOR_CTA_FONT_SIZE', 32),
    logoWidth: envInt(config, 'VIDEO_EDITOR_LOGO_WIDTH', 132),
    logoOpacity: envFloat(config, 'VIDEO_EDITOR_LOGO_OPACITY', 0.92),
    barHeightRatio: envFloat(config, 'VIDEO_EDITOR_BAR_HEIGHT_RATIO', 0.135),
    emojiFontFile: resolveEmojiFontFile(
      config.get<string>('VIDEO_EDITOR_EMOJI_FONT_FILE'),
    ),
    timeoutMs: envInt(config, 'VIDEO_EDITOR_TIMEOUT_MS', 120_000),
    durationToleranceSeconds: envFloat(
      config,
      'VIDEO_EDITOR_DURATION_TOLERANCE_SECONDS',
      2,
    ),
  };
}
