import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import type {
  GeneratedImage,
  ImageGenerationInput,
  ImageGenerationProvider,
} from './image-generation.provider';

@Injectable()
export class OpenAIImageGenerationProvider implements ImageGenerationProvider {
  private readonly logger = new Logger(OpenAIImageGenerationProvider.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY') || '';
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.model =
      this.config.get<string>('IMAGE_MODEL') ||
      this.config.get<string>('OPENAI_IMAGE_MODEL') ||
      'gpt-image-1';
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY no configurada para generar imágenes');
    }

    const started = Date.now();
    const size = this.normalizeSize(input.size);
    const prompt = input.prompt.slice(0, 3000);
    const quality = input.quality ?? 'medium';

    try {
      const refs = input.referenceImages?.slice(0, 4) ?? [];
      const result =
        refs.length > 0
          ? await this.client.images.edit({
              model: this.model,
              prompt,
              n: 1,
              size: size,
              quality,
              image: await Promise.all(
                refs.map((ref, index) =>
                  toFile(
                    ref.buffer,
                    ref.filename || `reference-${index + 1}.png`,
                    { type: ref.mimeType || 'image/png' },
                  ),
                ),
              ),
            })
          : await this.client.images.generate({
              model: this.model,
              prompt,
              n: 1,
              size: size,
              quality,
            });

      const item = result.data?.[0];
      const b64 = item?.b64_json;
      if (!b64) {
        throw new Error('OpenAI Image no devolvió b64_json');
      }

      const usage = (
        result as {
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          };
        }
      ).usage;

      const [width, height] = size.split('x').map(Number);
      const estimatedCost = this.estimateImageCost(this.model, size);

      return {
        buffer: Buffer.from(b64, 'base64'),
        mimeType: 'image/png',
        width,
        height,
        provider: 'openai',
        model: this.model,
        prompt: input.prompt,
        estimatedCost,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      this.logger.error(
        `Image generation failed (${this.model}): ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw error;
    }
  }

  private normalizeSize(size: string): string {
    const allowed = new Set(['1024x1024', '1024x1536', '1536x1024']);
    if (allowed.has(size)) return size;
    if (
      size.includes('9:16') ||
      size.includes('story') ||
      size.includes('vertical')
    ) {
      return '1024x1536';
    }
    if (size.includes('16:9') || size.includes('landscape')) {
      return '1536x1024';
    }
    return '1024x1024';
  }

  private estimateImageCost(model: string, size: string): number {
    const base =
      model.includes('1.5') || model.includes('image-2') ? 0.04 : 0.04;
    const multiplier = size === '1024x1024' ? 1 : 1.5;
    return Number((base * multiplier).toFixed(6));
  }
}
