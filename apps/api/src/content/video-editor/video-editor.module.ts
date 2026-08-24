import { Module } from '@nestjs/common';
import { FfmpegProcessRunner, FFMPEG_RUNNER } from './ffmpeg.runner';
import { VideoEditorService } from './video-editor.service';

@Module({
  providers: [
    FfmpegProcessRunner,
    {
      provide: FFMPEG_RUNNER,
      useExisting: FfmpegProcessRunner,
    },
    VideoEditorService,
  ],
  exports: [VideoEditorService, FFMPEG_RUNNER],
})
export class VideoEditorModule {}
