import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  asRecord,
  asString,
  downloadBinary,
  requestJson,
  sleep,
} from '../video-http';
import type {
  GeneratedVideo,
  VideoGenerationInput,
  VideoGenerationProvider,
} from '../video-generation.provider';
import { clampDurationForFal } from '../video-duration';
import {
  VideoGenerationFailedError,
  VideoProviderUnavailableError,
} from '../video.errors';

@Injectable()
export class FalVideoProvider implements VideoGenerationProvider {
  readonly name = 'fal' as const;
  private readonly logger = new Logger(FalVideoProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly estimatedCost: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('FAL_KEY')?.trim() ||
      this.config.get<string>('FAL_API_KEY')?.trim() ||
      '';
    this.model =
      this.config.get<string>('FAL_VIDEO_MODEL')?.trim() ||
      'fal-ai/kling-video/v1/standard/text-to-video';
    this.timeoutMs = Number(
      this.config.get<string>('VIDEO_TIMEOUT_MS') || 12 * 60 * 1000,
    );
    this.pollMs = Number(
      this.config.get<string>('VIDEO_POLL_INTERVAL_MS') || 4000,
    );
    this.estimatedCost = Number(
      this.config.get<string>('FAL_VIDEO_ESTIMATED_COST') || 0.18,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(input: VideoGenerationInput): Promise<GeneratedVideo> {
    if (!this.isConfigured()) {
      throw new VideoProviderUnavailableError(
        this.name,
        'FAL_KEY no configurada',
      );
    }

    const started = Date.now();
    const aspectRatio = input.aspectRatio ?? '9:16';
    const durationSeconds = clampDurationForFal(
      this.model,
      input.durationSeconds ?? 5,
    );
    const prompt = input.prompt.slice(0, 2500);

    try {
      const submitted = await this.submit(
        input,
        prompt,
        aspectRatio,
        durationSeconds,
      );
      const videoUrl = await this.pollResult(
        submitted.statusUrl,
        submitted.responseUrl,
      );
      const file = await downloadBinary(videoUrl);
      const [width, height] = this.dimsForAspect(aspectRatio);

      return {
        buffer: file.buffer,
        mimeType: file.mimeType.includes('video') ? file.mimeType : 'video/mp4',
        sourceUrl: videoUrl,
        width,
        height,
        durationSeconds,
        provider: this.name,
        model: this.model,
        prompt: input.prompt,
        estimatedCost: this.estimatedCost,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (
        error instanceof VideoProviderUnavailableError ||
        error instanceof VideoGenerationFailedError
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Error fal.ai';
      this.logger.error(`fal video failed (${this.model}): ${message}`);
      throw new VideoProviderUnavailableError(this.name, message, error);
    }
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Key ${this.apiKey}` };
  }

  private async submit(
    input: VideoGenerationInput,
    prompt: string,
    aspectRatio: string,
    durationSeconds: number,
  ): Promise<{ statusUrl: string; responseUrl: string }> {
    const body: Record<string, unknown> = {
      prompt,
      aspect_ratio: aspectRatio,
      duration: String(durationSeconds),
    };
    if (input.resolution) body.resolution = input.resolution;
    if (input.generateAudio != null) body.generate_audio = input.generateAudio;
    const refs = (input.referenceImageUrls ?? []).filter(Boolean).slice(0, 1);
    if (refs[0]) body.image_url = refs[0];

    const res = await requestJson<Record<string, unknown>>({
      method: 'POST',
      url: `https://queue.fal.run/${this.model}`,
      headers: this.authHeaders(),
      body,
      timeoutMs: 30_000,
    });

    if ([401, 403].includes(res.status)) {
      throw new VideoGenerationFailedError(
        this.name,
        asString(res.json.detail) || 'fal.ai rechazó la API key',
      );
    }
    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      throw new VideoProviderUnavailableError(
        this.name,
        asString(res.json.detail) || `fal.ai no disponible (${res.status})`,
      );
    }
    if (res.status >= 400) {
      throw new VideoGenerationFailedError(
        this.name,
        asString(res.json.detail) ||
          asString(res.json.error) ||
          `fal.ai HTTP ${res.status}`,
      );
    }

    const statusUrl = asString(res.json.status_url);
    const responseUrl = asString(res.json.response_url);
    const requestId = asString(res.json.request_id);
    if (statusUrl && responseUrl) {
      return { statusUrl, responseUrl };
    }
    if (requestId) {
      const base = `https://queue.fal.run/${this.model}/requests/${requestId}`;
      return { statusUrl: `${base}/status`, responseUrl: base };
    }
    throw new VideoGenerationFailedError(
      this.name,
      'fal.ai no devolvió request_id',
    );
  }

  private async pollResult(
    statusUrl: string,
    responseUrl: string,
  ): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const res = await requestJson<Record<string, unknown>>({
        method: 'GET',
        url: statusUrl,
        headers: this.authHeaders(),
      });
      if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
        throw new VideoProviderUnavailableError(
          this.name,
          `fal.ai status ${res.status}`,
        );
      }
      if (res.status >= 400) {
        throw new VideoGenerationFailedError(
          this.name,
          asString(res.json.detail) || `fal.ai status HTTP ${res.status}`,
        );
      }

      const status = String(res.json.status ?? '').toUpperCase();
      if (status === 'COMPLETED') {
        return this.fetchVideoUrl(responseUrl);
      }
      if (status === 'FAILED' || status === 'CANCELLED') {
        throw new VideoGenerationFailedError(
          this.name,
          asString(res.json.error) || `fal.ai ${status.toLowerCase()}`,
        );
      }
      await sleep(this.pollMs);
    }
    throw new VideoProviderUnavailableError(
      this.name,
      `Timeout esperando video de fal.ai (${Math.round(this.timeoutMs / 1000)}s)`,
    );
  }

  private async fetchVideoUrl(responseUrl: string): Promise<string> {
    const res = await requestJson<Record<string, unknown>>({
      method: 'GET',
      url: responseUrl,
      headers: this.authHeaders(),
    });
    if (res.status >= 400) {
      throw new VideoGenerationFailedError(
        this.name,
        asString(res.json.detail) || `fal.ai result HTTP ${res.status}`,
      );
    }
    const url =
      asString(asRecord(res.json.video)?.url) ||
      asString(res.json.url) ||
      asString(asRecord(asRecord(res.json.data)?.video)?.url);
    if (!url) {
      throw new VideoGenerationFailedError(
        this.name,
        'fal.ai no devolvió URL de video',
      );
    }
    return url;
  }

  private dimsForAspect(aspect: string): [number, number] {
    if (aspect === '16:9') return [1280, 720];
    if (aspect === '1:1') return [1080, 1080];
    return [1080, 1920];
  }
}
