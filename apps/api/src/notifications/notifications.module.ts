import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { EmailModule } from '../email/email.module';
import { AdminNotifyAdminController } from './admin-notify-admin.controller';
import { AdminNotifyService } from './admin-notify.service';

@Module({
  imports: [BusinessesModule, EmailModule],
  controllers: [AdminNotifyAdminController],
  providers: [AdminNotifyService],
  exports: [AdminNotifyService],
})
export class NotificationsModule {}
