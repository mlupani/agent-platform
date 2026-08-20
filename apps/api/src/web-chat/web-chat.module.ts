import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { WebChatAdminController } from './web-chat-admin.controller';
import { WebChatApiKeyGuard } from './web-chat-api-key.guard';
import { WebChatConfigService } from './web-chat-config.service';
import { WebChatController } from './web-chat.controller';
import { WebChatService } from './web-chat.service';

@Module({
  imports: [BusinessesModule, forwardRef(() => AiModule)],
  controllers: [WebChatAdminController, WebChatController],
  providers: [WebChatConfigService, WebChatService, WebChatApiKeyGuard],
  exports: [WebChatConfigService],
})
export class WebChatModule {}
