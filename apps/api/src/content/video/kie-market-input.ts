export const DEFAULT_KIE_VIDEO_MODEL = 'bytedance/seedance-1.5-pro';

const KIE_MODEL_ALIASES: Record<string, string> = {
  'bytedance/seedance-2.0': 'bytedance/seedance-2',
  'bytedance/seedance-2.0-fast': 'bytedance/seedance-2-fast',
  'bytedance/seedance-2.0-mini': 'bytedance/seedance-2-mini',
  'seedance-2': 'bytedance/seedance-2',
  'seedance-2.0': 'bytedance/seedance-2',
  'seedance-2-fast': 'bytedance/seedance-2-fast',
  'seedance-2-mini': 'bytedance/seedance-2-mini',
};

export function resolveKieVideoModel(raw: string | undefined): string {
  const trimmed = raw?.trim() || DEFAULT_KIE_VIDEO_MODEL;
  return KIE_MODEL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function isSeedance2Model(model: string): boolean {
  return /seedance-2/i.test(resolveKieVideoModel(model));
}

export function buildKieMarketInput(opts: {
  model: string;
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  generateAudio: boolean;
  resolution?: string;
  referenceImageUrls?: string[];
}): Record<string, unknown> {
  const model = resolveKieVideoModel(opts.model);
  const refs = (opts.referenceImageUrls ?? []).filter(Boolean).slice(0, 2);

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
