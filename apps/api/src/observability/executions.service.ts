import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

@Injectable()
export class ExecutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  async list(params?: {
    limit?: number;
    conversationId?: string;
    success?: boolean;
  }) {
    const businessId = await this.businesses.getCurrentId();
    const limit = Math.min(Math.max(params?.limit ?? 30, 1), 100);

    return this.prisma.agentExecution.findMany({
      where: {
        businessId,
        ...(params?.conversationId
          ? { conversationId: params.conversationId }
          : {}),
        ...(typeof params?.success === 'boolean'
          ? { success: params.success }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        conversationId: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCost: true,
        durationMs: true,
        steps: true,
        success: true,
        error: true,
        createdAt: true,
        _count: { select: { toolExecutions: true } },
      },
    });
  }

  async get(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const execution = await this.prisma.agentExecution.findFirst({
      where: { id, businessId },
      include: {
        toolExecutions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            tool: true,
            input: true,
            output: true,
            durationMs: true,
            success: true,
            error: true,
            createdAt: true,
          },
        },
        conversation: {
          select: {
            id: true,
            channel: true,
            status: true,
            contactName: true,
            contactPhone: true,
          },
        },
      },
    });
    if (!execution) throw new NotFoundException('Ejecución no encontrada');
    return execution;
  }
}
