import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ExecutionsService } from './executions.service';

@Controller('admin/executions')
@UseGuards(ApiKeyGuard)
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('conversationId') conversationId?: string,
    @Query('success') success?: string,
  ) {
    return this.executions.list({
      limit: limit ? Number(limit) : undefined,
      conversationId,
      success:
        success === 'true' ? true : success === 'false' ? false : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.executions.get(id);
  }
}
