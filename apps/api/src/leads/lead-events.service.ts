import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class LeadEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: {
    businessId: string;
    leadId: string;
    type: string;
    actor?: 'agent' | 'admin' | 'system';
    payload?: Record<string, unknown>;
  }) {
    return this.prisma.leadEvent.create({
      data: {
        businessId: input.businessId,
        leadId: input.leadId,
        type: input.type,
        actor: input.actor ?? 'system',
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  list(businessId: string, leadId: string) {
    return this.prisma.leadEvent.findMany({
      where: { businessId, leadId },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
  }
}
