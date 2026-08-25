import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { PackBalanceService } from './pack-balance.service';
import { PacksAdminController } from './packs-admin.controller';

@Module({
  imports: [BusinessesModule],
  controllers: [PacksAdminController],
  providers: [PackBalanceService],
  exports: [PackBalanceService],
})
export class PacksModule {}
