import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({
  enabledOnly: z.boolean().optional(),
});

@Injectable()
export class GetServicesTool implements AgentTool {
  readonly name = 'getServices';
  readonly description =
    'Lista los servicios del negocio (nombre, duración, precio, si requiere cita).';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input ?? {});
    const services = await this.prisma.service.findMany({
      where: {
        businessId: context.businessId,
        ...(data.enabledOnly === false ? {} : { enabled: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        durationMinutes: true,
        price: true,
        priceDescription: true,
        requiresAppointment: true,
        enabled: true,
      },
    });

    return {
      success: true,
      data: {
        services: services.map((service) => ({
          ...service,
          price: service.price?.toString() ?? null,
        })),
      },
    };
  }
}
