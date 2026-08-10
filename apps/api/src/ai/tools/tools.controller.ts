import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ToolRegistry } from './tool-registry';

@Controller('admin/tools')
@UseGuards(ApiKeyGuard)
export class ToolsController {
  constructor(private readonly registry: ToolRegistry) {}

  @Get()
  list() {
    return this.registry.getAvailableTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
    }));
  }
}
