import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  LEAD_FOLLOW_UP_JOB,
  LEAD_FOLLOW_UP_QUEUE,
  LEAD_FOLLOW_UP_SCHEDULER_ID,
} from './lead-follow-up.queue';

@Injectable()
export class LeadFollowUpScheduler implements OnModuleInit {
  private readonly logger = new Logger(LeadFollowUpScheduler.name);

  constructor(
    @InjectQueue(LEAD_FOLLOW_UP_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      LEAD_FOLLOW_UP_SCHEDULER_ID,
      { pattern: '0 * * * * *' },
      {
        name: LEAD_FOLLOW_UP_JOB,
        data: {},
        opts: {
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      },
    );
    this.logger.log('Cron de follow-ups de leads: cada minuto');
  }
}
