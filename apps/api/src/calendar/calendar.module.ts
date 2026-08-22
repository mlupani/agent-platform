import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BusinessesModule } from '../businesses/businesses.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { EmailModule } from '../email/email.module';
import { SocialModule } from '../social/social.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AppointmentsAdminController } from './appointments-admin.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { AppointmentReminderProcessor } from './appointment-reminder.processor';
import { APPOINTMENT_REMINDER_QUEUE } from './appointment-reminder.queue';
import { AppointmentReminderScheduler } from './appointment-reminder.scheduler';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AppointmentRemindersAdminController } from './appointment-reminders-admin.controller';
import {
  CalendarAdminController,
  GoogleOAuthController,
} from './calendar-admin.controller';
import { GoogleCalendarConfigService } from './google-calendar-config.service';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [
    BusinessesModule,
    EmailModule,
    forwardRef(() => WhatsAppModule),
    forwardRef(() => SocialModule),
    BullModule.registerQueue({ name: APPOINTMENT_REMINDER_QUEUE }),
  ],
  controllers: [
    CalendarAdminController,
    GoogleOAuthController,
    AppointmentsAdminController,
    AppointmentRemindersAdminController,
  ],
  providers: [
    SecretsService,
    GoogleCalendarConfigService,
    GoogleCalendarService,
    AvailabilityService,
    AppointmentsService,
    AppointmentReminderService,
    AppointmentReminderScheduler,
    AppointmentReminderProcessor,
  ],
  exports: [
    AppointmentsService,
    AvailabilityService,
    GoogleCalendarService,
    GoogleCalendarConfigService,
  ],
})
export class CalendarModule {}
