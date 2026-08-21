import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ContentService } from './content.service';
import { CONTENT_VIDEO_QUEUE } from './content-video-generate.queue';

@Processor(CONTENT_VIDEO_QUEUE, {
  lockDuration: 15 * 60 * 1000,
  stalledInterval: 60_000,
})
export class ContentVideoGenerateProcessor extends WorkerHost {
  private readonly logger = new Logger(ContentVideoGenerateProcessor.name);

  constructor(private readonly content: ContentService) {
    super();
  }

  async process(job: Job<{ contentId: string; businessId: string }>): Promise<void> {
    const contentId = job.data?.contentId;
    const businessId = job.data?.businessId;
    if (!contentId || !businessId) {
      this.logger.warn(`Job ${job.id} sin contentId/businessId`);
      return;
    }

    this.logger.log(`Video generate start content=${contentId} job=${job.id}`);
    await this.content.processQueuedGeneration(contentId, businessId);
  }
}
