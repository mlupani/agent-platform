export type VideoAspectRatio = '9:16' | '16:9' | '1:1';
export type VideoResolution = '480p' | '720p' | '1080p';

export type VideoProviderName = 'kie' | 'fal' | 'veo';

export interface VideoGenerationInput {
  prompt: string;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  resolution?: VideoResolution;
  generateAudio?: boolean;
  /** Frames / refs públicas (producto, local, estilo) */
  referenceImageUrls?: string[];
}

export interface GeneratedVideo {
  buffer: Buffer;
  mimeType: string;
  sourceUrl: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  provider: VideoProviderName;
  model: string;
  prompt: string;
  estimatedCost?: number;
  durationMs: number;
  usedFallback?: boolean;
}

export interface VideoGenerationProvider {
  readonly name: VideoProviderName;
  isConfigured(): boolean;
  generate(input: VideoGenerationInput): Promise<GeneratedVideo>;
}

export const VIDEO_GENERATION_PROVIDERS = Symbol('VIDEO_GENERATION_PROVIDERS');
