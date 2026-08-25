import { Module } from '@nestjs/common';
import { PackBalanceService } from './pack-balance.service';
import { PacksAdminController } from './packs-admin.controller';

@Module({
  controllers: [PacksAdminController],
  providers: [PackBalanceService],
  exports: [PackBalanceService],
})
export class PacksModule {}
