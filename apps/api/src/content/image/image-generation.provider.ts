export interface ImageGenerationInput {
  prompt: string;
  /** ej. 1024x1024 | 1024x1536 | 1536x1024 */
  size: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  /** Imágenes de referencia (producto, local, estilo) para images.edit */
  referenceImages?: Array<{ buffer: Buffer; mimeType: string; filename?: string }>;
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  provider: string;
  model: string;
  prompt: string;
  estimatedCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

export interface ImageGenerationProvider {
  generate(input: ImageGenerationInput): Promise<GeneratedImage>;
}

export const IMAGE_GENERATION_PROVIDER = Symbol('IMAGE_GENERATION_PROVIDER');
