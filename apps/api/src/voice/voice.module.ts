import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { ElevenLabsProvider } from './elevenlabs.provider';
import { VoiceService } from './voice.service';
import { VoiceController } from './voice.controller';
import { PrismaModule } from '../common/prisma/prisma.module';
import { CloudinaryStorageProvider } from '../content/storage/cloudinary-storage.provider';
import { STORAGE_PROVIDER } from '../content/storage/storage.provider';
import { CompositionModule } from '../composition/composition.module';

@Module({
  imports: [BusinessesModule, PrismaModule, CompositionModule],
  controllers: [VoiceController],
  providers: [
    ElevenLabsProvider,
    VoiceService,
    CloudinaryStorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: CloudinaryStorageProvider },
  ],
  exports: [ElevenLabsProvider, VoiceService],
})
export class VoiceModule {}
