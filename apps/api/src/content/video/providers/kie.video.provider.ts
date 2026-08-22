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
import { clampDurationForKie } from '../video-duration';
import {
  VideoGenerationFailedError,
  VideoProviderUnavailableError,
} from '../video.errors';

interface KieTaskResult {
  state: string;
  videoUrl?: string;
  error?: string;
}

@Injectable()
export class KieVideoProvider implements VideoGenerationProvider {
  readonly name = 'kie' as const;
  private readonly logger = new Logger(KieVideoProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly estimatedCost: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('KIE_API_KEY')?.trim() || '';
    this.baseUrl = (
      this.config.get<string>('KIE_API_URL') || 'https://api.kie.ai'
    ).replace(/\/$/, '');
    this.model =
      this.config.get<string>('KIE_VIDEO_MODEL')?.trim() ||
      'bytedance/seedance-1.5-pro';
    this.timeoutMs = Number(
      this.config.get<string>('VIDEO_TIMEOUT_MS') || 12 * 60 * 1000,
    );
    this.pollMs = Number(
      this.config.get<string>('VIDEO_POLL_INTERVAL_MS') || 5000,
    );
    this.estimatedCost = Number(
      this.config.get<string>('KIE_VIDEO_ESTIMATED_COST') || 0.08,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(input: VideoGenerationInput): Promise<GeneratedVideo> {
    if (!this.isConfigured()) {
      throw new VideoProviderUnavailableError(
        this.name,
        'KIE_API_KEY no configurada',
      );
    }

    const started = Date.now();
    const prompt = input.prompt.slice(0, 2500);
    const aspectRatio = input.aspectRatio ?? '9:16';
    const durationSeconds = clampDurationForKie(
      this.model,
      input.durationSeconds ?? 5,
    );

    try {
      const taskId = this.isVeoModel(this.model)
        ? await this.createVeoTask(prompt, aspectRatio)
        : await this.createMarketTask(
            input,
            prompt,
            aspectRatio,
            durationSeconds,
          );

      const result = await this.pollTask(taskId);
      if (!result.videoUrl) {
        throw new VideoGenerationFailedError(
          this.name,
          result.error || 'Kie.ai no devolvió URL de video',
        );
      }

      const file = await downloadBinary(result.videoUrl);
      const [width, height] = this.dimsForAspect(aspectRatio);

      return {
        buffer: file.buffer,
        mimeType: file.mimeType.includes('video') ? file.mimeType : 'video/mp4',
        sourceUrl: result.videoUrl,
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
      const message = error instanceof Error ? error.message : 'Error Kie.ai';
      this.logger.error(`Kie video failed (${this.model}): ${message}`);
      throw new VideoProviderUnavailableError(this.name, message, error);
    }
  }

  private isVeoModel(model: string): boolean {
    return /^veo/i.test(model);
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async createMarketTask(
    input: VideoGenerationInput,
    prompt: string,
    aspectRatio: string,
    durationSeconds: number,
  ): Promise<string> {
    const payload = {
      model: this.model,
      input: this.buildMarketInput(input, prompt, aspectRatio, durationSeconds),
    };

    const res = await requestJson<{
      code?: number;
      msg?: string;
      message?: string;
      data?: { taskId?: string; task_id?: string };
    }>({
      method: 'POST',
      url: `${this.baseUrl}/api/v1/jobs/createTask`,
      headers: this.authHeaders(),
      body: payload,
      timeoutMs: 30_000,
    });

    this.assertKieOk(
      res.status,
      res.json.code,
      res.json.msg || res.json.message,
    );
    const taskId = res.json.data?.taskId || res.json.data?.task_id;
    if (!taskId) {
      throw new VideoGenerationFailedError(
        this.name,
        'Kie.ai no devolvió taskId',
      );
    }
    return taskId;
  }

  private buildMarketInput(
    input: VideoGenerationInput,
    prompt: string,
    aspectRatio: string,
    durationSeconds: number,
  ): Record<string, unknown> {
    const refs = (input.referenceImageUrls ?? []).filter(Boolean).slice(0, 2);
    const body: Record<string, unknown> = {
      prompt,
      aspect_ratio: aspectRatio,
      duration: durationSeconds,
      generate_audio: Boolean(input.generateAudio),
    };
    if (input.resolution) body.resolution = input.resolution;
    if (refs.length) {
      body.input_urls = refs;
      body.image_urls = refs;
    }
    return body;
  }

  private async createVeoTask(
    prompt: string,
    aspectRatio: string,
  ): Promise<string> {
    const res = await requestJson<{
      code?: number;
      msg?: string;
      data?: { taskId?: string; task_id?: string };
    }>({
      method: 'POST',
      url: `${this.baseUrl}/api/v1/veo/generate`,
      headers: this.authHeaders(),
      body: {
        prompt,
        model: this.model,
        aspect_ratio: aspectRatio,
      },
      timeoutMs: 30_000,
    });

    this.assertKieOk(res.status, res.json.code, res.json.msg);
    const taskId = res.json.data?.taskId || res.json.data?.task_id;
    if (!taskId) {
      throw new VideoGenerationFailedError(
        this.name,
        'Kie.ai Veo no devolvió taskId',
      );
    }
    return taskId;
  }

  private async pollTask(taskId: string): Promise<KieTaskResult> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const result = this.isVeoModel(this.model)
        ? await this.readVeoStatus(taskId)
        : await this.readMarketStatus(taskId);

      if (result.state === 'success') return result;
      if (result.state === 'fail') {
        throw new VideoGenerationFailedError(
          this.name,
          result.error || 'Kie.ai falló la generación',
        );
      }
      await sleep(this.pollMs);
    }
    throw new VideoProviderUnavailableError(
      this.name,
      `Timeout esperando video de Kie.ai (${Math.round(this.timeoutMs / 1000)}s)`,
    );
  }

  private async readMarketStatus(taskId: string): Promise<KieTaskResult> {
    const res = await requestJson<{
      code?: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>({
      method: 'GET',
      url: `${this.baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      headers: this.authHeaders(),
    });
    this.assertKieOk(res.status, res.json.code, res.json.msg);
    const data = res.json.data ?? {};
    const state = String(data.state ?? '').toLowerCase();
    if (state === 'fail' || state === 'failed') {
      return {
        state: 'fail',
        error:
          asString(data.failMsg) || asString(data.errorMessage) || res.json.msg,
      };
    }
    if (state === 'success') {
      return { state: 'success', videoUrl: this.extractVideoUrl(data) };
    }
    return { state: state || 'generating' };
  }

  private async readVeoStatus(taskId: string): Promise<KieTaskResult> {
    const res = await requestJson<{
      code?: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>({
      method: 'GET',
      url: `${this.baseUrl}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
      headers: this.authHeaders(),
    });
    this.assertKieOk(res.status, res.json.code, res.json.msg);
    const data = res.json.data ?? {};
    const flag = Number(data.successFlag ?? -1);
    if (flag === 1) {
      return { state: 'success', videoUrl: this.extractVideoUrl(data) };
    }
    if (flag === 2 || flag === 3) {
      return {
        state: 'fail',
        error:
          asString(data.errorMessage) ||
          res.json.msg ||
          'Veo generation failed',
      };
    }
    return { state: 'generating' };
  }

  private extractVideoUrl(data: Record<string, unknown>): string | undefined {
    const direct =
      asString(data.resultUrl) ||
      asString(data.videoUrl) ||
      asString(asRecord(data.videoInfo)?.videoUrl) ||
      asString(asRecord(data.response)?.resultUrl);
    if (direct) return direct;

    const parsed =
      this.parseMaybeJson(data.resultJson) ??
      this.parseMaybeJson(data.resultUrls);
    const fromParsed = this.firstUrl(parsed);
    if (fromParsed) return fromParsed;

    return (
      this.firstUrl(data.resultUrls) || this.firstUrl(asRecord(data.response))
    );
  }

  private parseMaybeJson(value: unknown): unknown {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  private firstUrl(value: unknown): string | undefined {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.firstUrl(item);
        if (found) return found;
      }
    }
    const rec = asRecord(value);
    if (!rec) return undefined;
    for (const key of ['resultUrls', 'resultUrl', 'videoUrl', 'url', 'video']) {
      const found = this.firstUrl(rec[key]);
      if (found) return found;
    }
    return undefined;
  }

  private assertKieOk(httpStatus: number, code?: number, msg?: string) {
    if (httpStatus === 401 || httpStatus === 403) {
      throw new VideoGenerationFailedError(
        this.name,
        msg || 'Kie.ai rechazó la API key',
      );
    }
    if ([408, 429, 500, 502, 503, 504].includes(httpStatus)) {
      throw new VideoProviderUnavailableError(
        this.name,
        msg || `Kie.ai no disponible (${httpStatus})`,
      );
    }
    if (httpStatus >= 400) {
      throw new VideoGenerationFailedError(
        this.name,
        msg || `Kie.ai HTTP ${httpStatus}`,
      );
    }
    if (code != null && code !== 200) {
      const message = msg || `Kie.ai code ${code}`;
      if (
        [429, 500, 502, 503].includes(code) ||
        /busy|demand|queue|overloaded/i.test(message)
      ) {
        throw new VideoProviderUnavailableError(this.name, message);
      }
      throw new VideoGenerationFailedError(this.name, message);
    }
  }

  private dimsForAspect(aspect: string): [number, number] {
    if (aspect === '16:9') return [1280, 720];
    if (aspect === '1:1') return [1080, 1080];
    return [1080, 1920];
  }
}
