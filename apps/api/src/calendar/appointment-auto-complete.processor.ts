import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { APPOINTMENT_AUTO_COMPLETE_QUEUE } from './appointment-auto-complete.queue';

@Processor(APPOINTMENT_AUTO_COMPLETE_QUEUE, {
  concurrency: 1,
  lockDuration: 2 * 60 * 1000,
})
export class AppointmentAutoCompleteProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentAutoCompleteProcessor.name);

  constructor(private readonly appointments: AppointmentsService) {
    super();
  }

  async process(): Promise<void> {
    const completed = await this.appointments.autoCompletePast();
    if (completed > 0) {
      this.logger.log(`Auto-complete: ${completed} clases completadas y packs descontados`);
    }
  }
}
