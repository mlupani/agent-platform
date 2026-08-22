import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const createSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  provider: z.string().default('openai'),
  model: z.string(),
  systemPrompt: z.string().min(1),
  personality: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxSteps: z.number().int().min(1).max(20).optional(),
  knowledgeBaseId: z.string().uuid().optional(),
  enabledTools: z.array(z.string()).default([]),
  enabledChannels: z
    .array(z.string())
    .default(['WEB', 'WHATSAPP', 'INSTAGRAM']),
  memoryStrategy: z
    .object({
      recentMessages: z.number().int().min(1).max(50).optional(),
      includeSummary: z.boolean().optional(),
      semanticTopK: z.number().int().min(0).max(20).optional(),
    })
    .optional(),
  isDefault: z.boolean().optional(),
});

@Controller('admin/agents')
@UseGuards(ApiKeyGuard)
export class AgentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('business/:businessId')
  list(@Param('businessId') businessId: string) {
    return this.prisma.agentConfig.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createSchema))
    body: z.infer<typeof createSchema>,
  ) {
    return this.prisma.agentConfig.create({ data: body });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(createSchema.partial().omit({ businessId: true })),
    )
    body: Partial<z.infer<typeof createSchema>>,
  ) {
    const existing = await this.prisma.agentConfig.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Agent not found');
    return this.prisma.agentConfig.update({ where: { id }, data: body });
  }
}
