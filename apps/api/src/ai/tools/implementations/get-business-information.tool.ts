import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({});

@Injectable()
export class GetBusinessInformationTool implements AgentTool {
  readonly name = 'getBusinessInformation';
  readonly description =
    'Obtiene información general del negocio: nombre, rubro, descripción, contacto, reseñas de Google, idioma y zona horaria.';
  readonly schema = schema;
  readonly risk = 'READ' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(_input: unknown, context: ToolContext): Promise<ToolResult> {
    const business = await this.prisma.business.findFirst({
      where: { id: context.businessId },
      select: {
        name: true,
        description: true,
        type: true,
        language: true,
        timezone: true,
        address: true,
        phone: true,
        whatsapp: true,
        email: true,
        website: true,
        instagram: true,
        googleReviewsUrl: true,
        additionalInfo: true,
        rules: true,
      },
    });

    if (!business) {
      return { success: false, error: 'Business not found' };
    }

    return { success: true, data: business };
  }
}
