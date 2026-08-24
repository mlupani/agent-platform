import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { GenerateVideosOperation } from '@google/genai';
import { downloadBinary, sleep } from '../video-http';
import type {
  GeneratedVideo,
  VideoGenerationInput,
  VideoGenerationProvider,
} from '../video-generation.provider';
import { clampDurationForVeo } from '../video-duration';
import {
  VideoGenerationFailedError,
  VideoProviderUnavailableError,
} from '../video.errors';

const DEFAULT_MODEL = 'veo-3.1-lite-generate-preview';

@Injectable()
export class VeoVideoProvider implements VideoGenerationProvider {
  readonly name = 'veo' as const;
  private readonly logger = new Logger(VeoVideoProvider.name);
  private readonly apiKey: string;
  private readonly client: GoogleGenAI | null;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly estimatedCost: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('GOOGLE_GENERATIVE_AI_API_KEY')?.trim() ||
      this.config.get<string>('GEMINI_API_KEY')?.trim() ||
      '';
    this.client = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;
    this.model =
      this.config.get<string>('VEO_VIDEO_MODEL')?.trim() || DEFAULT_MODEL;
    this.timeoutMs = Number(
      this.config.get<string>('VIDEO_TIMEOUT_MS') || 12 * 60 * 1000,
    );
    this.pollMs = Number(
      this.config.get<string>('VIDEO_POLL_INTERVAL_MS') || 8000,
    );
    this.estimatedCost = Number(
      this.config.get<string>('VEO_VIDEO_ESTIMATED_COST') || 0.2,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.client);
  }

  async generate(input: VideoGenerationInput): Promise<GeneratedVideo> {
    if (!this.client || !this.isConfigured()) {
      throw new VideoProviderUnavailableError(
        this.name,
        'GOOGLE_GENERATIVE_AI_API_KEY no configurada',
      );
    }

    const started = Date.now();
    const prompt = input.prompt.slice(0, 1024);
    const aspectRatio = this.resolveAspect(input.aspectRatio);
    const resolution = this.resolveResolution(input.resolution);
    const durationSeconds = clampDurationForVeo(input.durationSeconds ?? 5);
    const generateAudio = input.generateAudio !== false;
    const effectiveModel = input.model?.trim() || this.model;

    try {
      const image = await this.firstFrame(input.referenceImageUrls);
      let operation = await this.client.models.generateVideos({
        model: effectiveModel,
        prompt,
        ...(image ? { image } : {}),
        config: {
          aspectRatio,
          resolution,
          durationSeconds,
          generateAudio,
          numberOfVideos: 1,
        },
      });

      operation = await this.poll(operation);
      const videoFile = this.extractVideo(operation);
      const buffer = await this.toBuffer(videoFile);
      const [width, height] = this.dimsForAspect(aspectRatio, resolution);

      return {
        buffer,
        mimeType: videoFile.mimeType?.includes('video')
          ? videoFile.mimeType
          : 'video/mp4',
        sourceUrl: videoFile.uri || `veo://${effectiveModel}`,
        width,
        height,
        durationSeconds,
        provider: this.name,
        model: effectiveModel,
        prompt: input.prompt,
        estimatedCost: this.estimatedCost || durationSeconds * 0.05,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (
        error instanceof VideoProviderUnavailableError ||
        error instanceof VideoGenerationFailedError
      ) {
        throw error;
      }
      this.rethrow(error);
    }
  }

  private async poll(
    initial: GenerateVideosOperation,
  ): Promise<GenerateVideosOperation> {
    const deadline = Date.now() + this.timeoutMs;
    let operation = initial;
    while (!operation.done) {
      if (Date.now() >= deadline) {
        throw new VideoProviderUnavailableError(
          this.name,
          `Timeout esperando video de Veo (${Math.round(this.timeoutMs / 1000)}s)`,
        );
      }
      await sleep(this.pollMs);
      try {
        operation = await this.client!.operations.getVideosOperation({
          operation,
        });
      } catch (error) {
        this.rethrow(error);
      }
    }
    if (operation.error) {
      const details = operation.error as { message?: unknown; code?: unknown };
      const message =
        typeof details.message === 'string' && details.message.trim()
          ? details.message
          : 'Veo falló la generación';
      this.rethrow(Object.assign(new Error(message), { status: details.code }));
    }
    return operation;
  }

  private extractVideo(operation: GenerateVideosOperation): {
    uri?: string;
    videoBytes?: string;
    mimeType?: string;
  } {
    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video) {
      throw new VideoGenerationFailedError(
        this.name,
        'Veo no devolvió un video',
      );
    }
    return video;
  }

  private async toBuffer(video: {
    uri?: string;
    videoBytes?: string;
    mimeType?: string;
  }): Promise<Buffer> {
    const fromField = this.decodeBytes(video.videoBytes);
    if (fromField?.length) return fromField;

    if (video.uri) {
      try {
        const file = await downloadBinary(video.uri, 120_000, {
          'x-goog-api-key': this.apiKey,
        });
        if (file.buffer.length) return file.buffer;
      } catch (error) {
        this.logger.warn(
          `Veo URI download falló: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    const dir = await mkdtemp(join(tmpdir(), 'veo-'));
    const downloadPath = join(dir, 'video.mp4');
    try {
      await this.client!.files.download({
        file: video as never,
        downloadPath,
      });
      const fromDisk = await readFile(downloadPath);
      if (fromDisk.length) return fromDisk;
      const afterDownload = this.decodeBytes(video.videoBytes);
      if (afterDownload?.length) return afterDownload;
    } catch (error) {
      this.logger.warn(
        `Veo files.download falló: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    throw new VideoGenerationFailedError(
      this.name,
      'Veo no devolvió bytes ni URL de video',
    );
  }

  private decodeBytes(value: unknown): Buffer | null {
    if (!value) return null;
    if (Buffer.isBuffer(value)) return value.length ? value : null;
    if (value instanceof Uint8Array) {
      return value.length ? Buffer.from(value) : null;
    }
    if (value instanceof ArrayBuffer) {
      return value.byteLength ? Buffer.from(value) : null;
    }
    if (typeof value === 'string' && value.trim()) {
      return Buffer.from(value, 'base64');
    }
    if (typeof value === 'object' && 'data' in (value as object)) {
      return this.decodeBytes((value as { data?: unknown }).data);
    }
    return null;
  }

  private async firstFrame(
    urls?: string[],
  ): Promise<{ imageBytes: string; mimeType: string } | undefined> {
    const url = (urls ?? []).find((item) => item?.trim());
    if (!url) return undefined;
    try {
      const file = await downloadBinary(url);
      return {
        imageBytes: file.buffer.toString('base64'),
        mimeType: file.mimeType || 'image/png',
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo usar la imagen de referencia de Veo: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return undefined;
    }
  }

  private resolveAspect(value?: string): '9:16' | '16:9' {
    return value === '16:9' ? '16:9' : '9:16';
  }

  private resolveResolution(value?: string): '720p' | '1080p' {
    return value === '1080p' ? '1080p' : '720p';
  }

  private dimsForAspect(
    aspect: '9:16' | '16:9',
    resolution: '720p' | '1080p',
  ): [number, number] {
    if (resolution === '1080p') {
      return aspect === '16:9' ? [1920, 1080] : [1080, 1920];
    }
    return aspect === '16:9' ? [1280, 720] : [720, 1280];
  }

  private rethrow(error: unknown): never {
    const status = this.errorStatus(error);
    const message =
      error instanceof Error ? error.message : 'Error de Gemini Veo';
    this.logger.error(`Veo video failed (${this.model}): ${message}`);
    if ([408, 429, 500, 502, 503, 504].includes(status)) {
      throw new VideoProviderUnavailableError(this.name, message, error);
    }
    if (
      /resource.?exhausted|unavailable|overloaded|rate limit|too many requests|quota/i.test(
        message,
      )
    ) {
      throw new VideoProviderUnavailableError(this.name, message, error);
    }
    throw new VideoGenerationFailedError(this.name, message, error);
  }

  private errorStatus(error: unknown): number {
    if (!error || typeof error !== 'object') return NaN;
    const rec = error as { status?: unknown; code?: unknown };
    const raw = rec.status ?? rec.code;
    if (typeof raw === 'number') return raw;
    if (raw === 'RESOURCE_EXHAUSTED') return 429;
    if (raw === 'UNAVAILABLE') return 503;
    if (raw === 'DEADLINE_EXCEEDED') return 408;
    return Number(raw);
  }
}
