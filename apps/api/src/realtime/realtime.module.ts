import { Module } from '@nestjs/common';
import { RealtimeEventsService } from './realtime.events.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  providers: [RealtimeGateway, RealtimeEventsService],
  exports: [RealtimeEventsService, RealtimeGateway],
})
export class RealtimeModule {}
