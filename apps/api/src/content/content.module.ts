import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { InstagramModule } from '../instagram/instagram.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ContentAdminController } from './content-admin.controller';
import { ContentAgentService } from './content-agent.service';
import { ContentAutoGenerateProcessor } from './content-auto-generate.processor';
import { CONTENT_AUTO_QUEUE } from './content-auto-generate.queue';
import { ContentAutoGenerateScheduler } from './content-auto-generate.scheduler';
import { ContentService } from './content.service';
import { ContentVideoGenerateProcessor } from './content-video-generate.processor';
import { CONTENT_VIDEO_QUEUE } from './content-video-generate.queue';
import { IMAGE_GENERATION_PROVIDER } from './image/image-generation.provider';
import { OpenAIImageGenerationProvider } from './image/openai-image.provider';
import { CloudinaryStorageProvider } from './storage/cloudinary-storage.provider';
import { STORAGE_PROVIDER } from './storage/storage.provider';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    BusinessesModule,
    AiModule,
    AnalyticsModule,
    RealtimeModule,
    WhatsAppModule,
    InstagramModule,
    VideoModule,
    BullModule.registerQueue({ name: CONTENT_AUTO_QUEUE }),
    BullModule.registerQueue({ name: CONTENT_VIDEO_QUEUE }),
  ],
  controllers: [ContentAdminController],
  providers: [
    ContentService,
    ContentAgentService,
    ContentAutoGenerateScheduler,
    ContentAutoGenerateProcessor,
    ContentVideoGenerateProcessor,
    OpenAIImageGenerationProvider,
    CloudinaryStorageProvider,
    {
      provide: IMAGE_GENERATION_PROVIDER,
      useExisting: OpenAIImageGenerationProvider,
    },
    {
      provide: STORAGE_PROVIDER,
      useExisting: CloudinaryStorageProvider,
    },
  ],
  exports: [ContentService],
})
export class ContentModule {}
