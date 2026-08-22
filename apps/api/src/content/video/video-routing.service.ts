import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GeneratedVideo,
  VideoGenerationInput,
  VideoGenerationProvider,
  VideoProviderName,
} from './video-generation.provider';
import { VideoProviderFactory } from './video-provider.factory';
import { isRetryableVideoError } from './video.errors';

export interface ResolvedVideoTarget {
  providerName: VideoProviderName;
  provider: VideoGenerationProvider;
  isFallback?: boolean;
}

@Injectable()
export class VideoRoutingService {
  private readonly logger = new Logger(VideoRoutingService.name);

  constructor(
    private readonly env: ConfigService,
    private readonly factory: VideoProviderFactory,
  ) {}

  resolvePrimary(): ResolvedVideoTarget {
    const name = this.readName('VIDEO_PROVIDER', 'kie');
    return {
      providerName: name,
      provider: this.factory.get(name),
    };
  }

  resolveFallback(currentProviderName: string): ResolvedVideoTarget | null {
    const enabled =
      (this.env.get<string>('VIDEO_FALLBACK_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
    if (!enabled) return null;

    const fallbackName = this.readName('VIDEO_FALLBACK_PROVIDER', 'fal');
    if (fallbackName === currentProviderName) return null;

    const provider = this.factory.get(fallbackName);
    if (!provider.isConfigured()) return null;

    return {
      providerName: fallbackName,
      provider,
      isFallback: true,
    };
  }

  async generate(input: VideoGenerationInput): Promise<GeneratedVideo> {
    let target = this.resolvePrimary();
    if (!target.provider.isConfigured()) {
      const fallback = this.resolveFallback(target.providerName);
      if (!fallback) {
        throw new Error(
          `Ningún provider de video está configurado. Completá KIE_API_KEY o FAL_KEY.`,
        );
      }
      this.logger.warn(
        `Video primary ${target.providerName} sin API key. Usando ${fallback.providerName}`,
      );
      target = fallback;
    }

    try {
      const video = await target.provider.generate(input);
      return { ...video, usedFallback: Boolean(target.isFallback) };
    } catch (error) {
      const fallback = this.resolveFallback(target.providerName);
      if (!fallback || !isRetryableVideoError(error)) {
        throw error;
      }
      this.logger.warn(
        `Video ${target.providerName} falló (${
          error instanceof Error ? error.message : 'unknown'
        }). Fallback → ${fallback.providerName}`,
      );
      const video = await fallback.provider.generate(input);
      return { ...video, usedFallback: true };
    }
  }

  private readName(
    key: string,
    fallback: VideoProviderName,
  ): VideoProviderName {
    const raw = (this.env.get<string>(key) || fallback).trim().toLowerCase();
    if (raw === 'kie' || raw === 'kie.ai') return 'kie';
    if (raw === 'fal' || raw === 'fal.ai') return 'fal';
    return fallback;
  }
}
