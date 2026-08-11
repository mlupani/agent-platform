import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { ContentService } from './content.service';
import { CONTENT_AUTO_QUEUE } from './content-auto-generate.queue';

@Processor(CONTENT_AUTO_QUEUE, {
  // Generación de imagen puede tardar varios minutos
  lockDuration: 10 * 60 * 1000,
  stalledInterval: 60_000,
})
export class ContentAutoGenerateProcessor extends WorkerHost {
  private readonly logger = new Logger(ContentAutoGenerateProcessor.name);

  constructor(
    private readonly content: ContentService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<{ businessId: string }>): Promise<void> {
    const businessId = job.data?.businessId;
    if (!businessId) {
      this.logger.warn(`Job ${job.id} sin businessId`);
      return;
    }

    const config = await this.prisma.socialContentConfig.findUnique({
      where: { businessId },
      include: {
        business: { select: { name: true, timezone: true } },
      },
    });
    if (!config?.autoGenerateEnabled) {
      this.logger.debug(`Skip auto-generate disabled business=${businessId}`);
      return;
    }

    const zone =
      config.business.timezone?.trim() || 'America/Argentina/Buenos_Aires';
    const now = DateTime.now().setZone(zone);
    if (
      config.lastAutoGenerateAt &&
      DateTime.fromJSDate(config.lastAutoGenerateAt).setZone(zone) >=
        now.startOf('day')
    ) {
      this.logger.debug(
        `Skip auto-generate already ran today business=${businessId}`,
      );
      return;
    }

    this.logger.log(
      `Cron fire business=${config.business.name} (${businessId}) job=${job.id}`,
    );
    await this.content.runScheduledGeneration(businessId);
  }
}
