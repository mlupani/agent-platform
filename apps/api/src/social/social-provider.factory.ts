import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { SocialProvider } from './social-provider.interface';
import { SOCIAL_PROVIDERS } from './social-provider.interface';
import type { SocialProviderName } from './social.types';

@Injectable()
export class SocialProviderFactory {
  private readonly byName: Map<string, SocialProvider>;

  constructor(
    @Inject(SOCIAL_PROVIDERS)
    providers: SocialProvider[],
  ) {
    this.byName = new Map(providers.map((provider) => [provider.name, provider]));
  }

  get(name: SocialProviderName = 'zernio'): SocialProvider {
    const provider = this.byName.get(name);
    if (!provider) {
      throw new BadRequestException(
        `Social provider "${name}" no está implementado. Disponibles: ${this.names().join(', ')}`,
      );
    }
    return provider;
  }

  names(): SocialProviderName[] {
    return [...this.byName.keys()] as SocialProviderName[];
  }
}
