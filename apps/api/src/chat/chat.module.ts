import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { ChatController } from './chat.controller';

@Module({
  imports: [AiModule, BusinessesModule],
  controllers: [ChatController],
})
export class ChatModule {}
