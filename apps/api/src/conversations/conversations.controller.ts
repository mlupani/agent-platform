import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { conversationStatuses } from '../common/constants';
import { ConversationsService } from './conversations.service';

const statusSchema = z.object({
  status: z.enum(conversationStatuses),
});

const replySchema = z.object({
  content: z.string().min(1).max(4000),
});

@Controller('admin/conversations')
@UseGuards(ApiKeyGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.conversations.list(status);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Query('markRead') markRead?: string,
  ) {
    return this.conversations.get(id, { markRead: markRead !== 'false' });
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema))
    body: z.infer<typeof statusSchema>,
  ) {
    return this.conversations.updateStatus(id, body.status);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.conversations.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.conversations.resume(id);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.conversations.close(id);
  }

  @Post(':id/messages')
  reply(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replySchema))
    body: z.infer<typeof replySchema>,
  ) {
    return this.conversations.sendHumanMessage(id, body.content);
  }
}
