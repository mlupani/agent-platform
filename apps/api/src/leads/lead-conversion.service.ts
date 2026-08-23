import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadEventsService } from './lead-events.service';
import { LeadLifecycleService } from './lead-lifecycle.service';

@Injectable()
export class LeadConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LeadEventsService,
    private readonly lifecycle: LeadLifecycleService,
  ) {}

  async convert(input: {
    businessId: string;
    leadId: string;
    source: string;
    actor?: 'agent' | 'admin' | 'system';
    statusSlug?: string;
  }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, businessId: input.businessId },
      include: { conversation: true },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    if (lead.status === 'won' && lead.userId) {
      return this.prisma.lead.findFirstOrThrow({
        where: { id: lead.id },
        include: { user: { include: { status: true } } },
      });
    }

    const config = await this.lifecycle.getPublic(input.businessId);
    const slug =
      input.statusSlug ??
      (input.source === 'appointment.confirmed'
        ? config.trialClientStatusSlug
        : config.convertedClientStatusSlug);
    const status = await this.resolveStatus(slug);
    const user = await this.upsertUser(lead, status.id);

    const updated = await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        userId: user.id,
        status: 'won',
        convertedAt: new Date(),
        conversionSource: input.source,
        name: lead.name || user.name,
        email: lead.email || user.email,
        phone: lead.phone || user.phone,
      },
      include: { user: { include: { status: true } } },
    });

    if (lead.conversationId && !lead.conversation?.userId) {
      await this.prisma.conversation.update({
        where: { id: lead.conversationId },
        data: { userId: user.id },
      });
    }

    await this.prisma.leadFollowUp.updateMany({
      where: {
        leadId: lead.id,
        businessId: input.businessId,
        status: { in: ['pending', 'generating', 'review'] },
      },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'converted',
      },
    });

    await this.events.append({
      businessId: input.businessId,
      leadId: lead.id,
      type: 'converted',
      actor: input.actor ?? 'system',
      payload: { userId: user.id, source: input.source },
    });

    return updated;
  }

  async maybeConvertFromSignal(input: {
    businessId: string;
    userId?: string | null;
    conversationId?: string | null;
    trigger: string;
  }) {
    const config = await this.lifecycle.getPublic(input.businessId);
    if (!config.conversionTriggers.includes(input.trigger)) return null;
    if (config.conversionMode === 'manual') return null;

    const lead = await this.findOpenLead(input);
    if (!lead) return null;

    if (config.conversionMode === 'suggested') {
      await this.events.append({
        businessId: input.businessId,
        leadId: lead.id,
        type: 'conversion_suggested',
        payload: { trigger: input.trigger },
      });
      return { suggested: true, leadId: lead.id };
    }

    return this.convert({
      businessId: input.businessId,
      leadId: lead.id,
      source: input.trigger,
    });
  }

  private async findOpenLead(input: {
    businessId: string;
    userId?: string | null;
    conversationId?: string | null;
  }) {
    if (input.conversationId) {
      const byConversation = await this.prisma.lead.findFirst({
        where: {
          businessId: input.businessId,
          conversationId: input.conversationId,
          status: { notIn: ['won', 'lost', 'inactive'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (byConversation) return byConversation;
    }
    if (input.userId) {
      return this.prisma.lead.findFirst({
        where: {
          businessId: input.businessId,
          userId: input.userId,
          status: { notIn: ['won', 'lost', 'inactive'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return null;
  }

  private async upsertUser(
    lead: {
      businessId: string;
      userId: string | null;
      conversation: { userId: string | null } | null;
      name: string | null;
      email: string | null;
      phone: string | null;
    },
    statusId: string,
  ) {
    const existingId = lead.userId || lead.conversation?.userId || null;
    if (existingId) {
      const existing = await this.prisma.user.findFirst({
        where: { id: existingId, businessId: lead.businessId },
      });
      if (existing) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: {
            name: existing.name || lead.name,
            email: existing.email || lead.email,
            phone: existing.phone || lead.phone,
            statusId,
          },
        });
      }
    }

    if (lead.phone) {
      const byPhone = await this.prisma.user.findFirst({
        where: { businessId: lead.businessId, phone: lead.phone },
      });
      if (byPhone) {
        return this.prisma.user.update({
          where: { id: byPhone.id },
          data: {
            name: byPhone.name || lead.name,
            email: byPhone.email || lead.email,
            statusId,
          },
        });
      }
    }

    if (lead.email) {
      const byEmail = await this.prisma.user.findFirst({
        where: { businessId: lead.businessId, email: lead.email },
      });
      if (byEmail) {
        return this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            name: byEmail.name || lead.name,
            phone: byEmail.phone || lead.phone,
            statusId,
          },
        });
      }
    }

    if (!lead.name && !lead.email && !lead.phone) {
      throw new BadRequestException(
        'No se puede convertir: el lead no tiene datos de contacto.',
      );
    }

    return this.prisma.user.create({
      data: {
        businessId: lead.businessId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        statusId,
        metadata: { origin: 'lead_conversion' },
      },
    });
  }

  private async resolveStatus(slug: string) {
    const status = await this.prisma.clientStatus.findUnique({
      where: { slug },
    });
    if (!status) {
      throw new BadRequestException(`Estado de cliente inválido: ${slug}`);
    }
    return status;
  }
}
