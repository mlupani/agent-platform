import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WebChatApiKeyGuard, type WidgetAuthedRequest } from './web-chat-api-key.guard';
import { WebChatService } from './web-chat.service';

const messageSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  source: z.string().min(1).max(64).optional(),
  visitorName: z.string().min(1).max(120).optional(),
});

@Controller('widget')
@UseGuards(WebChatApiKeyGuard)
export class WebChatController {
  constructor(private readonly webChat: WebChatService) {}

  @Post('messages')
  send(
    @Req() req: WidgetAuthedRequest,
    @Body(new ZodValidationPipe(messageSchema))
    body: z.infer<typeof messageSchema>,
  ) {
    const auth = req.webChatAuth!;
    return this.webChat.handleMessage({
      businessId: auth.businessId,
      message: body.message,
      conversationId: body.conversationId,
      source: body.source,
      visitorName: body.visitorName,
      origin: req.headers.origin,
    });
  }

  @Get('conversations/:id')
  history(
    @Req() req: WidgetAuthedRequest,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    const auth = req.webChatAuth!;
    return this.webChat.getConversation(auth.businessId, conversationId);
  }
}
