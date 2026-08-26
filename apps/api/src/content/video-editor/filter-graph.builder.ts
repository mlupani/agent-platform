import type { VideoEditorSettings } from './video-editor.config';
import { escapeFfmpegPath, isNearAspectRatio } from './ffmpeg.escape';
import { overlayPalette } from './overlay-style';
import { fitOverlayText, measureLineWidth } from './text-overlay';
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
  hasBars: boolean,
): { x: string; y: string } {
  const left = `${safeSide}`;
  const right = `W-w-${safeSide}`;
  // Si hay barras arriba/abajo (hook/CTA), el logo va FUERA de las barras para no taparlas:
  // top = debajo de la barra superior, bottom = encima de la barra inferior
  const top = hasBars ? `${barH}+${safeSide}` : `${safeSide}`;
  const bottom = hasBars ? `H-h-${barH}-${safeSide}` : `H-h-${safeSide}`;
  // Fallback para cuando no hay barras: mantener centrado dentro de margen pero con safe
  const topInside = `max(10\\,(${barH}-h)/2)`;
  const bottomInside = `H-${barH}+max(10\\,(${barH}-h)/2)`;
  // Si hay barras, usar fuera; si no, dentro (no hay hook/CTA que tapar)
  const yTop = hasBars ? top : topInside;
  const yBottom = hasBars ? bottom : bottomInside;
  if (position === 'top-left') return { x: left, y: yTop };
  if (position === 'bottom-left') return { x: left, y: yBottom };
  if (position === 'bottom-right') return { x: right, y: yBottom };
  return { x: right, y: yTop };
}

function fadeTiming(durationSeconds: number): {
  fadeIn: number;
  fadeOut: number;
  fadeOutStart: number;
} {
  const duration = Math.max(0.8, durationSeconds);
  const fadeIn = Number(Math.min(0.35, duration * 0.12).toFixed(2));
  const fadeOut = Number(Math.min(0.42, duration * 0.14).toFixed(2));
  return {
    fadeIn,
    fadeOut,
    fadeOutStart: Number(Math.max(0, duration - fadeOut).toFixed(2)),
  };
}

export function ctaButtonLayout(input: {
  width: number;
  height: number;
  barH: number;
  fontSize: number;
  text: string;
}): { btnW: number; btnH: number; btnX: number; btnY: number } {
  const lines = input.text.split('\n').filter(Boolean);
  const lineCount = Math.max(1, lines.length);
  const textW = Math.max(
    ...lines.map((line) => measureLineWidth(line, input.fontSize)),
    80,
  );
  const textH = Math.round(input.fontSize * lineCount * 1.28);
  const btnW = Math.min(
    Math.round(input.width * 0.72),
    Math.max(Math.round(input.width * 0.44), textW + 56),
  );
  const btnH = Math.min(
    Math.round(input.barH * 0.7),
    Math.max(50, textH + 24),
  );
  const btnX = Math.round((input.width - btnW) / 2);
  const lowerCenter = input.height - Math.round(input.barH * 0.52);
  const btnY = Math.max(
    input.height - input.barH + 8,
    lowerCenter - Math.round(btnH / 2),
  );
  return { btnW, btnH, btnX, btnY };
}

export function buildFilterGraph(input: {
  probe: VideoProbe;
  operations: VideoEditOperation[];
  settings: VideoEditorSettings;
  fontFile: string | null;
  hookTextFile?: string | null;
  ctaTextFile?: string | null;
  ctaHandFile?: string | null;
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
  const handFont = settings.emojiFontFile
    ? escapeFfmpegPath(settings.emojiFontFile)
    : fontfile;
  const palette = overlayPalette(input.accentColor);
  const hasBars = operations.some((op) => op.type === 'bars');
  const hasIntro = operations.some((op) => op.type === 'intro');
  const hasOutro = operations.some((op) => op.type === 'outro');

  if (hasIntro) {
    const zoom = nextLabel();
    filters.push(
      `[${current}]scale=iw*(1+0.08*max(0\\,1-t/0.65)):ih*(1+0.08*max(0\\,1-t/0.65)):eval=frame,crop=${width}:${height}[${zoom}]`,
    );
    current = zoom;
    const flash = nextLabel();
    filters.push(
      `[${current}]drawbox=x=0:y=0:w=${width}:h=${height}:color=white@0.2:t=fill:enable='lt(t,0.12)'[${flash}]`,
    );
    current = flash;
    applied.push('intro');
  }

  if (hasBars) {
    const bottomBar = nextLabel();
    filters.push(
      `[${current}]drawbox=x=0:y=${height - barH}:w=${width}:h=${barH}:color=black@0.78:t=fill[${bottomBar}]`,
    );
    current = bottomBar;
    applied.push('bars');
  }

  for (const op of operations) {
    if (op.type !== 'text') continue;
    const textFile = op.id === 'hook' ? input.hookTextFile : input.ctaTextFile;
    if (!textFile || !fontfile) continue;
    const fontSize = Math.max(12, Math.round(op.fontSize));

    if (op.id === 'cta') {
      const { btnW, btnH, btnY } = ctaButtonLayout({
        width,
        height,
        barH,
        fontSize,
        text: op.text,
      });
      const appear = `between(t,${op.start},${op.end})`;
      const slide = `26*max(0\\,1-(t-${op.start})/0.3)`;
      const pulse = `10*sin(2*PI*(t-${op.start})*2.05)`;
      const btnYExpr = `${btnY}+${slide}`;

      const shadow = nextLabel();
      filters.push(
        `[${current}]drawbox=x=(${width}-w)/2:y=${btnYExpr}+5:w=${btnW}+${pulse}+10:h=${btnH}+8:color=${palette.ctaShadow}:t=fill:enable='${appear}'[${shadow}]`,
      );
      current = shadow;
      const ring = nextLabel();
      filters.push(
        `[${current}]drawbox=x=(${width}-w)/2:y=${btnYExpr}-3:w=${btnW}+${pulse}+8:h=${btnH}+6:color=${palette.ctaRing}:t=fill:enable='${appear}'[${ring}]`,
      );
      current = ring;
      const button = nextLabel();
      filters.push(
        `[${current}]drawbox=x=(${width}-w)/2:y=${btnYExpr}:w=${btnW}+${pulse}:h=${btnH}:color=${palette.ctaBg}:t=fill:enable='${appear}'[${button}]`,
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
        `y=${btnYExpr}+(${btnH}-text_h)/2`,
        `alpha='if(lt(t,${op.start}+0.22)\\,(t-${op.start})/0.22\\,1)'`,
        `enable='${appear}'`,
      ];
      filters.push(`[${current}]drawtext=${options.join(':')}[${out}]`);
      current = out;

      if (input.ctaHandFile && handFont) {
        const handSize = Math.max(28, Math.round(fontSize * 1.15));
        const bounce = `8*sin(2*PI*(t-${op.start})*2.6)`;
        const hand = nextLabel();
        const handOpts = [
          `fontfile='${handFont}'`,
          `textfile='${escapeFfmpegPath(input.ctaHandFile)}'`,
          `fontsize=${handSize}`,
          'fontcolor=white',
          'borderw=2',
          'bordercolor=black@0.45',
          'expansion=none',
          'x=(w-text_w)/2',
          `y=${btnYExpr}-${handSize}-6+${bounce}`,
          `enable='${appear}'`,
        ];
        filters.push(`[${current}]drawtext=${handOpts.join(':')}[${hand}]`);
        current = hand;
      }
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
    const { x, y } = logoOverlayXY(logo.position, barH, safeSide, hasBars);
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

  if (hasOutro) {
    const { fadeIn, fadeOut, fadeOutStart } = fadeTiming(probe.durationSeconds);
    const faded = nextLabel();
    filters.push(
      `[${current}]fade=t=in:st=0:d=${fadeIn}:color=black,fade=t=out:st=${fadeOutStart}:d=${fadeOut}:color=black[${faded}]`,
    );
    current = faded;
    applied.push('outro');
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
  forceMotion?: boolean;
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
      20,
      Math.round((input.ctaFontSize ?? settings.ctaFontSize) * scale * 1.08),
    );
    const btnW = Math.round(width * 0.68);
    const fitted = fitOverlayText({
      text: input.ctaText,
      boxWidth: Math.max(100, btnW - 48),
      preferredFontSize: preferred,
      minFontSize: 18,
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

  if (ops.length || input.forceMotion) {
    ops.push({ type: 'intro' }, { type: 'outro' });
  }

  return ops;
}
