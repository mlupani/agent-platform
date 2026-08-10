import { Module } from '@nestjs/common';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { AgentsController } from './agents.controller';

@Module({
  controllers: [BusinessesController, AgentsController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
