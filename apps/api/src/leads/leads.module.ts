import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { LeadsAdminController } from './leads-admin.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [BusinessesModule],
  controllers: [LeadsAdminController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
