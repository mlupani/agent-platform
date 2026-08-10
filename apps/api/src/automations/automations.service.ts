import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { ToolResult } from '../ai/tools/agent-tool.interface';
import { N8nService } from './n8n.service';

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly n8n: N8nService,
  ) {}

  list(businessId: string) {
    return this.prisma.automation.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: {
    businessId: string;
    name: string;
    description?: string;
    webhookUrl: string;
    metadata?: object;
  }) {
    return this.prisma.automation.create({ data });
  }

  async triggerByName(
    businessId: string,
    name: string,
    payload: unknown,
    idempotencyKey?: string,
  ): Promise<ToolResult> {
    const automation = await this.prisma.automation.findFirst({
      where: { businessId, name, enabled: true },
    });

    if (!automation) {
      return {
        success: false,
        error: `Automation "${name}" not found or disabled`,
      };
    }

    const response = await this.n8n.triggerWebhook(
      automation.webhookUrl,
      payload,
      idempotencyKey,
    );

    return {
      success: true,
      data: { automationId: automation.id, response },
    };
  }
}
