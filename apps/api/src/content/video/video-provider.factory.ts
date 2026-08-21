import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  VideoGenerationProvider,
  VideoProviderName,
} from './video-generation.provider';
import { VIDEO_GENERATION_PROVIDERS } from './video-generation.provider';

@Injectable()
export class VideoProviderFactory {
  private readonly byName: Map<string, VideoGenerationProvider>;

  constructor(
    @Inject(VIDEO_GENERATION_PROVIDERS)
    providers: VideoGenerationProvider[],
  ) {
    this.byName = new Map(providers.map((provider) => [provider.name, provider]));
  }

  get(name: string): VideoGenerationProvider {
    const provider = this.byName.get(name);
    if (!provider) {
      throw new BadRequestException(
        `Video provider "${name}" no está implementado. Disponibles: ${this.names().join(', ')}`,
      );
    }
    return provider;
  }

  names(): VideoProviderName[] {
    return [...this.byName.keys()] as VideoProviderName[];
  }
}
