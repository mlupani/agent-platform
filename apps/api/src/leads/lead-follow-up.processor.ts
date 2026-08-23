import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { LeadFollowUpProcessorService } from './lead-follow-up-processor.service';
import { LEAD_FOLLOW_UP_QUEUE } from './lead-follow-up.queue';

@Processor(LEAD_FOLLOW_UP_QUEUE, {
  concurrency: 1,
  lockDuration: 2 * 60 * 1000,
})
export class LeadFollowUpProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadFollowUpProcessor.name);

  constructor(private readonly processor: LeadFollowUpProcessorService) {
    super();
  }

  async process(): Promise<void> {
    const handled = await this.processor.processDue();
    if (handled > 0) {
      this.logger.log(`Follow-ups procesados: ${handled}`);
    }
  }
}
