import { Module } from '@nestjs/common';
import { FalVideoProvider } from './providers/fal.video.provider';
import { KieVideoProvider } from './providers/kie.video.provider';
import { VIDEO_GENERATION_PROVIDERS } from './video-generation.provider';
import { VideoProviderFactory } from './video-provider.factory';
import { VideoRoutingService } from './video-routing.service';

@Module({
  providers: [
    KieVideoProvider,
    FalVideoProvider,
    VideoProviderFactory,
    VideoRoutingService,
    {
      provide: VIDEO_GENERATION_PROVIDERS,
      useFactory: (kie: KieVideoProvider, fal: FalVideoProvider) => [kie, fal],
      inject: [KieVideoProvider, FalVideoProvider],
    },
  ],
  exports: [VideoRoutingService, VideoProviderFactory],
})
export class VideoModule {}
