import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { WEEKDAY_LABELS } from '../../../common/constants';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({});

@Injectable()
export class GetOpeningHoursTool implements AgentTool {
  readonly name = 'getOpeningHours';
  readonly description =
    'Obtiene los horarios de atención del negocio (pueden tener varios rangos por día).';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(_input: unknown, context: ToolContext): Promise<ToolResult> {
    const business = await this.prisma.business.findFirst({
      where: { id: context.businessId },
      select: {
        timezone: true,
        defaultMessages: true,
        openingHours: true,
        businessHours: { orderBy: { dayOfWeek: 'asc' } },
      },
    });

    if (!business) {
      return { success: false, error: 'Business not found' };
    }

    const structured = business.businessHours.map((row) => {
      const ranges = Array.isArray(row.ranges)
        ? (row.ranges as Array<{ start: string; end: string }>)
        : [];
      return {
        dayOfWeek: row.dayOfWeek,
        day: WEEKDAY_LABELS[row.dayOfWeek],
        isClosed: row.isClosed || ranges.length === 0,
        ranges,
      };
    });

    return {
      success: true,
      data: {
        timezone: business.timezone,
        hours: structured.length ? structured : business.openingHours,
        offlineMessage:
          business.defaultMessages &&
          typeof business.defaultMessages === 'object' &&
          'offline' in business.defaultMessages
            ? (business.defaultMessages as { offline?: string }).offline
            : undefined,
      },
    };
  }
}
