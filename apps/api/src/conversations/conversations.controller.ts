import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ApiKeyGuard,
  type AuthedRequest,
} from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { conversationStatuses } from '../common/constants';
import type { AdminRole } from '../auth/auth.constants';
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

  private role(req: AuthedRequest): AdminRole {
    return req.adminUser?.role === 'ADMIN' ? 'ADMIN' : 'USER';
  }

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('sync') sync?: string,
  ) {
    return this.conversations.list(status, {
      role: this.role(req),
      pull: sync !== '0' && sync !== 'false',
    });
  }

  @Get(':id')
  get(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('markRead') markRead?: string,
  ) {
    return this.conversations.get(id, {
      markRead: markRead === 'true',
      role: this.role(req),
    });
  }

  @Post(':id/read')
  markRead(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.markRead(id, { role: this.role(req) });
  }

  @Patch(':id/status')
  updateStatus(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema))
    body: z.infer<typeof statusSchema>,
  ) {
    return this.conversations.updateStatus(id, body.status, {
      role: this.role(req),
    });
  }

  @Post(':id/pause')
  pause(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.pause(id, { role: this.role(req) });
  }

  @Post(':id/resume')
  resume(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.resume(id, { role: this.role(req) });
  }

  @Post(':id/close')
  close(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.close(id, { role: this.role(req) });
  }

  @Delete(':id')
  hide(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.hide(id, { role: this.role(req) });
  }

  @Post(':id/messages')
  reply(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replySchema))
    body: z.infer<typeof replySchema>,
  ) {
    return this.conversations.sendHumanMessage(id, body.content, {
      role: this.role(req),
    });
  }
}
