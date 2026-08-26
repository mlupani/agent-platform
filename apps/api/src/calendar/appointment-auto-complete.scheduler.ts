import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  APPOINTMENT_AUTO_COMPLETE_JOB,
  APPOINTMENT_AUTO_COMPLETE_QUEUE,
  APPOINTMENT_AUTO_COMPLETE_SCHEDULER_ID,
} from './appointment-auto-complete.queue';

@Injectable()
export class AppointmentAutoCompleteScheduler implements OnModuleInit {
  private readonly logger = new Logger(AppointmentAutoCompleteScheduler.name);

  constructor(
    @InjectQueue(APPOINTMENT_AUTO_COMPLETE_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      APPOINTMENT_AUTO_COMPLETE_SCHEDULER_ID,
      // cada 5 minutos
      { pattern: '0 */5 * * * *' },
      {
        name: APPOINTMENT_AUTO_COMPLETE_JOB,
        data: {},
        opts: {
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      },
    );
    this.logger.log('Cron auto-complete clases: cada 5 minutos');
  }
}
