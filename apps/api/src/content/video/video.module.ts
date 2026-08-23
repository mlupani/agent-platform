import { Module } from '@nestjs/common';
import { FalVideoProvider } from './providers/fal.video.provider';
import { KieVideoProvider } from './providers/kie.video.provider';
import { VeoVideoProvider } from './providers/veo.video.provider';
import { VIDEO_GENERATION_PROVIDERS } from './video-generation.provider';
import { VideoProviderFactory } from './video-provider.factory';
import { VideoRoutingService } from './video-routing.service';

@Module({
  providers: [
    KieVideoProvider,
    FalVideoProvider,
    VeoVideoProvider,
    VideoProviderFactory,
    VideoRoutingService,
    {
      provide: VIDEO_GENERATION_PROVIDERS,
      useFactory: (
        kie: KieVideoProvider,
        fal: FalVideoProvider,
        veo: VeoVideoProvider,
      ) => [kie, fal, veo],
      inject: [KieVideoProvider, FalVideoProvider, VeoVideoProvider],
    },
  ],
  exports: [VideoRoutingService, VideoProviderFactory],
})
export class VideoModule {}
