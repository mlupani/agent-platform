import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AppointmentReminderService } from './appointment-reminder.service';
import { APPOINTMENT_REMINDER_QUEUE } from './appointment-reminder.queue';

@Processor(APPOINTMENT_REMINDER_QUEUE, {
  concurrency: 1,
  lockDuration: 2 * 60 * 1000,
})
export class AppointmentReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentReminderProcessor.name);

  constructor(private readonly reminders: AppointmentReminderService) {
    super();
  }

  async process(): Promise<void> {
    const sent = await this.reminders.processDue();
    if (sent > 0) {
      this.logger.log(`Recordatorios enviados: ${sent}`);
    }
  }
}
