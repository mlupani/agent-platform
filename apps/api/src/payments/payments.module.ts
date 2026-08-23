import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { LeadsModule } from '../leads/leads.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [BusinessesModule, LeadsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
