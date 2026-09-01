export const DEFAULT_KIE_VIDEO_MODEL = 'bytedance/seedance-1.5-pro';

const KIE_MODEL_ALIASES: Record<string, string> = {
  'bytedance/seedance-2.0': 'bytedance/seedance-2',
  'bytedance/seedance-2.0-fast': 'bytedance/seedance-2-fast',
  'bytedance/seedance-2.0-mini': 'bytedance/seedance-2-mini',
  'seedance-2': 'bytedance/seedance-2',
  'seedance-2.0': 'bytedance/seedance-2',
  'seedance-2-fast': 'bytedance/seedance-2-fast',
  'seedance-2-mini': 'bytedance/seedance-2-mini',
  // Kling 3.0 (Omni) en Kie.ai — multi-shot, audio nativo, hasta 15s
  'kling-3.0-omni': 'kling-3.0/video',
  'kling-3.0-omni/video': 'kling-3.0/video',
  'kling-3.0': 'kling-3.0/video',
  'kling-3': 'kling-3.0/video',
  kling3: 'kling-3.0/video',
  // Kling 2.6 en Kie.ai — audio nativo, 5 o 10s. Base = text-to-video; con imagen
  // de referencia se cambia a kling-2.6/image-to-video (ver resolveKlingModelForRefs).
  'kling-2.6': 'kling-2.6/text-to-video',
  'kling-2.6-omni': 'kling-2.6/text-to-video',
  'kling-2.6/video': 'kling-2.6/text-to-video',
  'kling-26': 'kling-2.6/text-to-video',
  // Gemini Omni 1.1 Flash en Kie.ai — audio nativo, 4/6/8/10s, hasta 4K
  'gemini-omni-flash-1-1': 'gemini-omni-video',
  'gemini-omni-1.1-flash': 'gemini-omni-video',
  'gemini-omni-flash': 'gemini-omni-video',
  'gemini-omni': 'gemini-omni-video',
};

export function resolveKieVideoModel(raw: string | undefined): string {
  const trimmed = raw?.trim() || DEFAULT_KIE_VIDEO_MODEL;
  return KIE_MODEL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function isSeedance2Model(model: string): boolean {
  return /seedance-2/i.test(resolveKieVideoModel(model));
}

export function isKlingModel(model: string): boolean {
  return /kling/i.test(resolveKieVideoModel(model));
}

export function isKling3Model(model: string): boolean {
  return /kling-3/i.test(resolveKieVideoModel(model));
}

export function isKling26Model(model: string): boolean {
  return /kling-2\.6/i.test(resolveKieVideoModel(model));
}

export function isGeminiOmniModel(model: string): boolean {
  return /gemini-omni/i.test(resolveKieVideoModel(model));
}

/** Gemini Omni acepta 720p | 1080p | 4k. El panel manda 480p/720p/1080p. */
export function resolutionForGeminiOmni(
  resolution: string | undefined,
): string | undefined {
  const r = resolution?.trim().toLowerCase();
  if (r === '1080p') return '1080p';
  if (r === '4k') return '4k';
  if (r === '720p' || r === '480p') return '720p';
  return undefined;
}

/** Gemini Omni sólo acepta 16:9 o 9:16. */
export function aspectRatioForGeminiOmni(aspectRatio: string): string {
  return aspectRatio === '16:9' ? '16:9' : '9:16';
}

/**
 * Kling 2.6 expone IDs distintos para text-to-video e image-to-video.
 * Con imagen de referencia hay que apuntar al de image-to-video.
 */
export function resolveKlingModelForRefs(
  model: string,
  hasRefs: boolean,
): string {
  const resolved = resolveKieVideoModel(model);
  if (hasRefs && resolved === 'kling-2.6/text-to-video') {
    return 'kling-2.6/image-to-video';
  }
  return resolved;
}

/** Valida / normaliza el `mode` de Kling 3.0 (std | pro | 4K). */
export function normalizeKling3Mode(
  value: string | undefined,
): string | undefined {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === '4k') return '4K';
  if (v === 'std' || v === 'pro') return v;
  return undefined;
}

/** 1080p→pro, 720p/480p→std. Sin match → undefined (cae al default). */
export function resolutionToKling3Mode(
  resolution: string | undefined,
): string | undefined {
  const r = resolution?.trim().toLowerCase();
  if (r === '1080p') return 'pro';
  if (r === '720p' || r === '480p') return 'std';
  return undefined;
}

export function buildKieMarketInput(opts: {
  model: string;
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  generateAudio: boolean;
  resolution?: string;
  referenceImageUrls?: string[];
  /** Override de `mode` para Kling 3.0 (env KIE_KLING3_MODE). */
  klingMode?: string;
}): Record<string, unknown> {
  const refsAll = (opts.referenceImageUrls ?? []).filter(Boolean);
  const model = resolveKlingModelForRefs(
    resolveKieVideoModel(opts.model),
    refsAll.length > 0,
  );
  const refs = refsAll.slice(0, 2);

  if (isKling26Model(model)) {
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      sound: opts.generateAudio,
      duration: String(opts.durationSeconds),
    };
    if (model === 'kling-2.6/image-to-video') {
      body.image_urls = refs.slice(0, 1);
    } else {
      body.aspect_ratio = opts.aspectRatio;
    }
    return body;
  }

  if (isKling3Model(model)) {
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio,
      duration: String(opts.durationSeconds),
      sound: opts.generateAudio,
      mode:
        normalizeKling3Mode(opts.klingMode) ??
        resolutionToKling3Mode(opts.resolution) ??
        'pro',
      multi_shots: false,
    };
    if (refs.length) body.image_urls = refs;
    return body;
  }

  if (isGeminiOmniModel(model)) {
    // Sin campo de audio: Gemini Omni genera audio nativo desde el prompt.
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: aspectRatioForGeminiOmni(opts.aspectRatio),
      duration: String(opts.durationSeconds),
    };
    const res = resolutionForGeminiOmni(opts.resolution);
    if (res) body.resolution = res;
    const geminiRefs = refsAll.slice(0, 7);
    if (geminiRefs.length) body.image_urls = geminiRefs;
    return body;
  }

  if (isSeedance2Model(model)) {
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio,
      duration: opts.durationSeconds,
      generate_audio: opts.generateAudio,
    };
    if (opts.resolution) body.resolution = opts.resolution;
    if (refs[0]) body.first_frame_url = refs[0];
    if (refs[1]) body.last_frame_url = refs[1];
    return body;
  }

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio,
    duration: opts.durationSeconds,
    generate_audio: opts.generateAudio,
  };
  if (opts.resolution) body.resolution = opts.resolution;
  if (refs.length) {
    body.input_urls = refs;
    body.image_urls = refs;
  }
  return body;
}
