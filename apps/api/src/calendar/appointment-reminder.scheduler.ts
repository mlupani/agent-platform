import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  APPOINTMENT_REMINDER_JOB,
  APPOINTMENT_REMINDER_QUEUE,
  APPOINTMENT_REMINDER_SCHEDULER_ID,
} from './appointment-reminder.queue';

@Injectable()
export class AppointmentReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(AppointmentReminderScheduler.name);

  constructor(
    @InjectQueue(APPOINTMENT_REMINDER_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      APPOINTMENT_REMINDER_SCHEDULER_ID,
      { pattern: '0 * * * * *' },
      {
        name: APPOINTMENT_REMINDER_JOB,
        data: {},
        opts: {
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      },
    );
    this.logger.log('Cron de recordatorios de citas: cada minuto');
  }
}
