import { buildFilterGraph, planOperations } from './filter-graph.builder';
import type { VideoEditorSettings } from './video-editor.config';
import type { VideoProbe } from './video-editor.types';

const settings: VideoEditorSettings = {
  enabled: true,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  fontFile: '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  tmpDir: '/tmp',
  targetWidth: 720,
  targetHeight: 1280,
  safeMarginTop: 140,
  safeMarginBottom: 220,
  safeMarginSide: 64,
  hookFontSize: 56,
  ctaFontSize: 42,
  logoWidth: 120,
  logoOpacity: 0.85,
  barHeightRatio: 0.135,
  timeoutMs: 120000,
  durationToleranceSeconds: 2,
};

const verticalProbe: VideoProbe = {
  path: 'in.mp4',
  width: 720,
  height: 1280,
  durationSeconds: 12,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  hasAudio: true,
  hasVideo: true,
};

describe('planOperations / buildFilterGraph', () => {
  it('no planea resize si ya es 9:16', () => {
    const ops = planOperations({
      probe: verticalProbe,
      settings,
      addHook: false,
      hookText: '',
      hookStart: 0,
      hookEnd: 3,
      hookPosition: 'top',
      addCta: false,
      ctaText: '',
      ctaStart: 9,
      ctaEnd: 12,
      ctaPosition: 'bottom',
      addLogo: false,
      logoPosition: 'bottom-right',
    });
    expect(ops).toEqual([]);
  });

  it('agrega crop/scale si no es 9:16', () => {
    const ops = planOperations({
      probe: { ...verticalProbe, width: 1920, height: 1080 },
      settings,
      addHook: false,
      hookText: '',
      hookStart: 0,
      hookEnd: 3,
      hookPosition: 'top',
      addCta: false,
      ctaText: '',
      ctaStart: 9,
      ctaEnd: 12,
      ctaPosition: 'bottom',
      addLogo: false,
      logoPosition: 'bottom-right',
    });
    expect(ops).toEqual([{ type: 'resize', width: 720, height: 1280 }]);
    const graph = buildFilterGraph({
      probe: { ...verticalProbe, width: 1920, height: 1080 },
      operations: ops,
      settings,
      fontFile: settings.fontFile,
    });
    expect(graph.filterComplex).toContain(
      'scale=720:1280:force_original_aspect_ratio=increase',
    );
    expect(graph.filterComplex).toContain('crop=720:1280');
    expect(graph.filterComplex).not.toContain('drawtext=');
  });

  it('agrega drawtext para hook y CTA', () => {
    const ops = planOperations({
      probe: verticalProbe,
      settings,
      addHook: true,
      hookText: '¿Ya sabés dónde vas a comer este finde?',
      hookStart: 0,
      hookEnd: 3,
      hookPosition: 'top',
      addCta: true,
      ctaText: 'Reservá tu mesa',
      ctaStart: 9,
      ctaEnd: 12,
      ctaPosition: 'bottom',
      addLogo: false,
      logoPosition: 'bottom-right',
    });
    const graph = buildFilterGraph({
      probe: verticalProbe,
      operations: ops,
      settings,
      fontFile: settings.fontFile,
      hookTextFile: '/tmp/hook.txt',
      ctaTextFile: '/tmp/cta.txt',
    });
    expect(graph.filterComplex).toContain("enable='between(t,0,3)'");
    expect(graph.filterComplex).toContain("enable='between(t,9,12)'");
    expect(graph.filterComplex).toContain('drawtext=');
    expect(graph.filterComplex).toContain('drawbox=');
    expect(graph.operations).toContain('bars');
    expect(graph.needsLogoInput).toBe(false);
  });

  it('agrega overlay de logo', () => {
    const ops = planOperations({
      probe: verticalProbe,
      settings,
      addHook: false,
      hookText: '',
      hookStart: 0,
      hookEnd: 3,
      hookPosition: 'top',
      addCta: false,
      ctaText: '',
      ctaStart: 9,
      ctaEnd: 12,
      ctaPosition: 'bottom',
      addLogo: true,
      logoFilePath: '/tmp/logo.png',
      logoPosition: 'bottom-right',
    });
    const graph = buildFilterGraph({
      probe: verticalProbe,
      operations: ops,
      settings,
      fontFile: settings.fontFile,
    });
    expect(graph.needsLogoInput).toBe(true);
    expect(graph.filterComplex).toContain('overlay=');
    expect(graph.filterComplex).toContain('[1:v]scale=');
    expect(graph.filterComplex).toContain('drawbox=');
    expect(
      ops.some((op) => op.type === 'logo' && op.position === 'top-right'),
    ).toBe(true);
  });

  it('usa el color de marca en el botón de CTA', () => {
    const ops = planOperations({
      probe: verticalProbe,
      settings,
      addHook: false,
      hookText: '',
      hookStart: 0,
      hookEnd: 3,
      hookPosition: 'top',
      addCta: true,
      ctaText: 'Reservá tu mesa',
      ctaStart: 2,
      ctaEnd: 12,
      ctaPosition: 'bottom',
      addLogo: false,
      logoPosition: 'top-right',
    });
    const graph = buildFilterGraph({
      probe: verticalProbe,
      operations: ops,
      settings,
      fontFile: settings.fontFile,
      ctaTextFile: '/tmp/cta.txt',
      accentColor: '#C45C26',
    });
    expect(graph.filterComplex).toContain('0xC45C26');
    expect(graph.filterComplex).toContain('fontcolor=white');
  });

  it('no recorta un CTA largo: achica la letra o usa dos líneas', () => {
    const longCta = 'Mandanos un mensaje directo y reserve tu turno';
    const ops = planOperations({
      probe: verticalProbe,
      settings,
      addHook: false,
      hookText: '',
      hookStart: 0,
      hookEnd: 3,
      hookPosition: 'top',
      addCta: true,
      ctaText: longCta,
      ctaStart: 2,
      ctaEnd: 12,
      ctaPosition: 'bottom',
      addLogo: false,
      logoPosition: 'top-right',
    });
    const cta = ops.find((op) => op.type === 'text' && op.id === 'cta');
    expect(cta?.type).toBe('text');
    if (cta?.type !== 'text') return;
    expect(cta.text.replace(/\n/g, ' ')).toContain('reserve tu turno');
    expect(cta.text).not.toBe('Mandanos un mensaje directo y');
    expect(cta.fontSize).toBeLessThan(settings.ctaFontSize);
  });
});
