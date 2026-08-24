import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { CompositionService } from './composition.service';
import { VideoEditorModule } from '../content/video-editor/video-editor.module';
import { CloudinaryStorageProvider } from '../content/storage/cloudinary-storage.provider';
import { STORAGE_PROVIDER } from '../content/storage/storage.provider';

@Module({
  imports: [BusinessesModule, VideoEditorModule],
  providers: [
    CompositionService,
    CloudinaryStorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: CloudinaryStorageProvider },
  ],
  exports: [CompositionService],
})
export class CompositionModule {}
