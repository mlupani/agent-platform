import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { AppointmentsAdminController } from './appointments-admin.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from './availability.service';
import {
  CalendarAdminController,
  GoogleOAuthController,
} from './calendar-admin.controller';
import { GoogleCalendarConfigService } from './google-calendar-config.service';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [BusinessesModule],
  controllers: [
    CalendarAdminController,
    GoogleOAuthController,
    AppointmentsAdminController,
  ],
  providers: [
    SecretsService,
    GoogleCalendarConfigService,
    GoogleCalendarService,
    AvailabilityService,
    AppointmentsService,
  ],
  exports: [
    AppointmentsService,
    AvailabilityService,
    GoogleCalendarService,
    GoogleCalendarConfigService,
  ],
})
export class CalendarModule {}
