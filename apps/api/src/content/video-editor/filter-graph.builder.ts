import type { VideoEditorSettings } from './video-editor.config';
import { escapeFfmpegPath, isNearAspectRatio } from './ffmpeg.escape';
import { overlayPalette } from './overlay-style';
import { fitOverlayText } from './text-overlay';
import type {
  LogoCornerPosition,
  OverlayVerticalPosition,
  VideoEditOperation,
  VideoProbe,
} from './video-editor.types';

export interface BuiltFilterGraph {
  filterComplex: string;
  outputLabel: string;
  needsLogoInput: boolean;
  operations: VideoEditOperation['type'][];
}

export function needsVerticalResize(probe: VideoProbe): boolean {
  return !isNearAspectRatio(probe.width, probe.height);
}

function outputSize(
  probe: VideoProbe,
  operations: VideoEditOperation[],
): { width: number; height: number } {
  const resize = operations.find((op) => op.type === 'resize');
  if (resize && resize.type === 'resize') {
    return { width: resize.width, height: resize.height };
  }
  return { width: probe.width, height: probe.height };
}

function logoOverlayXY(
  position: LogoCornerPosition,
  barH: number,
  safeSide: number,
): { x: string; y: string } {
  const left = `${safeSide}`;
  const right = `W-w-${safeSide}`;
  const top = `max(10\\,(${barH}-h)/2)`;
  const bottom = `H-${barH}+max(10\\,(${barH}-h)/2)`;
  if (position === 'top-left') return { x: left, y: top };
  if (position === 'bottom-left') return { x: left, y: bottom };
  if (position === 'bottom-right') return { x: right, y: bottom };
  return { x: right, y: top };
}

export function buildFilterGraph(input: {
  probe: VideoProbe;
  operations: VideoEditOperation[];
  settings: VideoEditorSettings;
  fontFile: string | null;
  hookTextFile?: string | null;
  ctaTextFile?: string | null;
  accentColor?: string | null;
}): BuiltFilterGraph {
  const { probe, operations, settings } = input;
  const filters: string[] = [];
  const applied: VideoEditOperation['type'][] = [];
  let current = '0:v';
  let labelIndex = 0;
  const nextLabel = () => `v${++labelIndex}`;

  const resize = operations.find((op) => op.type === 'resize');
  if (resize && resize.type === 'resize') {
    const out = nextLabel();
    filters.push(
      `[${current}]scale=${resize.width}:${resize.height}:force_original_aspect_ratio=increase,crop=${resize.width}:${resize.height},setsar=1[${out}]`,
    );
    current = out;
    applied.push('resize');
  } else {
    const out = nextLabel();
    filters.push(`[${current}]setsar=1[${out}]`);
    current = out;
  }

  const { width, height } = outputSize(probe, operations);
  const scale = width / 720;
  const barH = Math.max(96, Math.round(height * settings.barHeightRatio));
  const safeSide = Math.round(settings.safeMarginSide * scale);
  const fontfile = input.fontFile ? escapeFfmpegPath(input.fontFile) : '';
  const palette = overlayPalette(input.accentColor);
  const hasBars = operations.some((op) => op.type === 'bars');

  if (hasBars) {
    const topBar = nextLabel();
    filters.push(
      `[${current}]drawbox=x=0:y=0:w=${width}:h=${barH}:color=black@0.82:t=fill[${topBar}]`,
    );
    current = topBar;
    const bottomBar = nextLabel();
    filters.push(
      `[${current}]drawbox=x=0:y=${height - barH}:w=${width}:h=${barH}:color=black@0.86:t=fill[${bottomBar}]`,
    );
    current = bottomBar;
    const accent = nextLabel();
    filters.push(
      `[${current}]drawbox=x=0:y=${barH - 3}:w=${width}:h=3:color=${palette.accent}:t=fill[${accent}]`,
    );
    current = accent;
    applied.push('bars');
  }

  for (const op of operations) {
    if (op.type !== 'text') continue;
    const textFile = op.id === 'hook' ? input.hookTextFile : input.ctaTextFile;
    if (!textFile || !fontfile) continue;
    const fontSize = Math.max(12, Math.round(op.fontSize));

    if (op.id === 'cta') {
      const lineCount = Math.max(1, op.text.split('\n').length);
      const btnW = Math.round(width * 0.9);
      const textH = Math.round(fontSize * lineCount * 1.28);
      const btnH = Math.min(
        barH - 12,
        Math.max(
          48,
          textH + 22,
          Math.round(barH * (lineCount > 1 ? 0.62 : 0.5)),
        ),
      );
      const btnX = Math.round((width - btnW) / 2);
      const btnY = height - barH + Math.round((barH - btnH) / 2);
      const button = nextLabel();
      filters.push(
        `[${current}]drawbox=x=${btnX}:y=${btnY}:w=${btnW}:h=${btnH}:color=${palette.ctaBg}:t=fill:enable='between(t,${op.start},${op.end})'[${button}]`,
      );
      current = button;
      const out = nextLabel();
      const options = [
        `fontfile='${fontfile}'`,
        `textfile='${escapeFfmpegPath(textFile)}'`,
        `fontsize=${fontSize}`,
        `fontcolor=${palette.ctaFg}`,
        'text_align=C',
        'expansion=none',
        `line_spacing=${Math.round(fontSize * 0.12)}`,
        'x=(w-text_w)/2',
        `y=${btnY}+(${btnH}-text_h)/2`,
        `enable='between(t,${op.start},${op.end})'`,
      ];
      filters.push(`[${current}]drawtext=${options.join(':')}[${out}]`);
      current = out;
      applied.push('text');
      continue;
    }

    const out = nextLabel();
    const options = [
      `fontfile='${fontfile}'`,
      `textfile='${escapeFfmpegPath(textFile)}'`,
      `fontsize=${fontSize}`,
      'fontcolor=white',
      'borderw=2',
      'bordercolor=black@0.55',
      'text_align=C',
      'expansion=none',
      `line_spacing=${Math.round(fontSize * 0.16)}`,
      'x=(w-text_w)/2',
      `y=max(10\\,(${barH}-text_h)/2)`,
      `enable='between(t,${op.start},${op.end})'`,
    ];
    filters.push(`[${current}]drawtext=${options.join(':')}[${out}]`);
    current = out;
    applied.push('text');
  }

  const logo = operations.find((op) => op.type === 'logo');
  let needsLogoInput = false;
  if (logo && logo.type === 'logo') {
    needsLogoInput = true;
    const logoLabel = 'logo';
    const out = nextLabel();
    const opacity = Math.min(1, Math.max(0.15, logo.opacity));
    const { x, y } = logoOverlayXY(logo.position, barH, safeSide);
    const logoMaxH = Math.round(barH * 0.72);
    filters.push(
      `[1:v]scale=${logo.width}:${logoMaxH}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${logoLabel}]`,
    );
    filters.push(
      `[${current}][${logoLabel}]overlay=${x}:${y}:format=auto[${out}]`,
    );
    current = out;
    applied.push('logo');
  }

  return {
    filterComplex: filters.join(';'),
    outputLabel: current,
    needsLogoInput,
    operations: applied,
  };
}

export function planOperations(input: {
  probe: VideoProbe;
  settings: VideoEditorSettings;
  addHook: boolean;
  hookText: string;
  hookStart: number;
  hookEnd: number;
  hookPosition: OverlayVerticalPosition;
  hookFontSize?: number;
  addCta: boolean;
  ctaText: string;
  ctaStart: number;
  ctaEnd: number;
  ctaPosition: OverlayVerticalPosition;
  ctaFontSize?: number;
  addLogo: boolean;
  logoFilePath?: string | null;
  logoPosition: LogoCornerPosition;
  logoWidth?: number;
  logoOpacity?: number;
}): VideoEditOperation[] {
  const ops: VideoEditOperation[] = [];
  const { probe, settings } = input;
  const resize = needsVerticalResize(probe);
  if (resize) {
    ops.push({
      type: 'resize',
      width: settings.targetWidth,
      height: settings.targetHeight,
    });
  }

  const width = resize ? settings.targetWidth : probe.width;
  const scale = width / 720;
  const side = Math.round(settings.safeMarginSide * scale);
  const addHook = input.addHook && Boolean(input.hookText);
  const addCta = input.addCta && Boolean(input.ctaText);
  const addLogo = input.addLogo && Boolean(input.logoFilePath);

  if (addHook || addCta || addLogo) {
    ops.push({ type: 'bars' });
  }

  if (addHook) {
    const preferred = Math.max(
      22,
      Math.round((input.hookFontSize ?? settings.hookFontSize) * scale),
    );
    const fitted = fitOverlayText({
      text: input.hookText,
      boxWidth: Math.max(120, width - side * 2),
      preferredFontSize: preferred,
      minFontSize: 20,
      maxLines: 2,
    });
    ops.push({
      type: 'text',
      id: 'hook',
      text: fitted.text,
      start: input.hookStart,
      end: input.hookEnd,
      position: 'top',
      fontSize: fitted.fontSize,
    });
  }

  if (addCta) {
    const preferred = Math.max(
      18,
      Math.round((input.ctaFontSize ?? settings.ctaFontSize) * scale),
    );
    const btnW = Math.round(width * 0.9);
    const fitted = fitOverlayText({
      text: input.ctaText,
      boxWidth: Math.max(100, btnW - 36),
      preferredFontSize: preferred,
      minFontSize: 16,
      maxLines: 2,
    });
    ops.push({
      type: 'text',
      id: 'cta',
      text: fitted.text,
      start: input.ctaStart,
      end: input.ctaEnd,
      position: 'bottom',
      fontSize: fitted.fontSize,
    });
  }

  if (addLogo && input.logoFilePath) {
    ops.push({
      type: 'logo',
      filePath: input.logoFilePath,
      position: input.logoPosition === 'top-left' ? 'top-left' : 'top-right',
      width: Math.round((input.logoWidth ?? settings.logoWidth) * scale),
      opacity: input.logoOpacity ?? settings.logoOpacity,
    });
  }

  return ops;
}
