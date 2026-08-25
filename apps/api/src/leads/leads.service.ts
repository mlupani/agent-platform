import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { LeadContactabilityService } from './lead-contactability.service';
import { LeadConversionService } from './lead-conversion.service';
import { LeadEventsService } from './lead-events.service';
import { LeadFollowUpService } from './lead-follow-up.service';
import {
  TERMINAL_LEAD_STATUSES,
  isLeadStatus,
  type LeadStatus,
} from './lead.constants';

const conversationSelect = {
  id: true,
  channel: true,
  contactName: true,
  contactPhone: true,
  lastMessageAt: true,
  hiddenAt: true,
} satisfies Prisma.ConversationSelect;

export interface LeadListItem {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  channel: string | null;
  conversationId: string | null;
  status: string;
  interest: string | null;
  isContactable: boolean;
  contactChannels: string[];
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  createdAt: Date;
}

export interface LeadCaptureInput {
  businessId: string;
  conversationId?: string;
  userId?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  source?: string | null;
  interest?: string | null;
  objections?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LeadManualInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  interest?: string | null;
  channel?: 'MANUAL' | 'WEB' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly contactability: LeadContactabilityService,
    private readonly events: LeadEventsService,
    private readonly conversion: LeadConversionService,
    private readonly followUps: LeadFollowUpService,
  ) {}

  async capture(input: LeadCaptureInput): Promise<{ id: string } | null> {
    const name = input.name?.trim() || null;
    const email = input.email?.trim() || null;
    const phone = input.phone?.trim() || null;
    const message = input.message?.trim() || null;
    const interest = input.interest?.trim() || null;
    const objections = input.objections?.trim() || null;

    const conversationId = input.conversationId || undefined;
    const existing = conversationId
      ? await this.prisma.lead.findFirst({
          where: { businessId: input.businessId, conversationId },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    if (!name && !email && !phone && !existing) return null;

    const conversation = conversationId
      ? await this.prisma.conversation.findFirst({
          where: { id: conversationId, businessId: input.businessId },
          select: { channel: true, contactPhone: true, userId: true },
        })
      : null;

    const contact = await this.contactability.resolve({
      businessId: input.businessId,
      phone,
      email,
      conversation: conversation
        ? { channel: conversation.channel, contactPhone: conversation.contactPhone }
        : null,
    });

    const requestedStatus =
      input.status && isLeadStatus(input.status) ? input.status : null;
    const nextStatus = this.nextStatus(
      existing?.status,
      requestedStatus,
      Boolean(conversationId),
      Boolean(interest),
    );

    const metadata = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...(input.metadata ?? {}),
      conversationId: conversationId ?? undefined,
      contactChannels: contact.channels,
    };

    if (existing) {
      if (TERMINAL_LEAD_STATUSES.includes(existing.status as LeadStatus)) {
        const updated = await this.prisma.lead.update({
          where: { id: existing.id },
          data: {
            name: name || existing.name,
            email: email || existing.email,
            phone: phone || existing.phone,
            message: message || existing.message,
            interest: interest || existing.interest,
            objections: objections || existing.objections,
            isContactable: contact.isContactable,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
        return { id: updated.id };
      }

      const updated = await this.prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          email: email || existing.email,
          phone: phone || existing.phone,
          message: message || existing.message,
          source: input.source || existing.source,
          userId: input.userId || conversation?.userId || existing.userId,
          interest: interest || existing.interest,
          objections: objections || existing.objections,
          status: nextStatus,
          isContactable: contact.isContactable,
          preferredChannel: contact.channels[0] || existing.preferredChannel,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      if (existing.status !== nextStatus) {
        await this.events.append({
          businessId: input.businessId,
          leadId: updated.id,
          type: 'status_changed',
          actor: 'agent',
          payload: { from: existing.status, to: nextStatus },
        });
      }
      if (nextStatus === 'interested') {
        await this.followUps.scheduleAutoSequence(input.businessId, updated.id);
      }
      return { id: updated.id };
    }

    const created = await this.prisma.lead.create({
      data: {
        businessId: input.businessId,
        userId: input.userId || conversation?.userId || null,
        conversationId,
        name,
        email,
        phone,
        message,
        source: input.source,
        interest,
        objections,
        status: nextStatus,
        isContactable: contact.isContactable,
        preferredChannel: contact.channels[0] || null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
    await this.events.append({
      businessId: input.businessId,
      leadId: created.id,
      type: 'captured',
      actor: input.metadata?.origin === 'manual' ? 'admin' : 'agent',
      payload: { source: input.source, status: nextStatus },
    });
    if (nextStatus === 'interested') {
      await this.followUps.scheduleAutoSequence(input.businessId, created.id);
    }
    return { id: created.id };
  }

  async createManual(input: LeadManualInput): Promise<{ id: string }> {
    const businessId = await this.businesses.getCurrentId();
    const channel = input.channel ?? 'MANUAL';
    const created = await this.capture({
      businessId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: input.message,
      interest: input.interest,
      source: channel,
      metadata: { origin: 'manual', channel },
    });
    if (!created) {
      throw new BadRequestException(
        'Hace falta al menos nombre, teléfono o email.',
      );
    }
    return created;
  }

  async list(filters?: {
    status?: string;
    contactable?: boolean;
    search?: string;
  }): Promise<LeadListItem[]> {
    const businessId = await this.businesses.getCurrentId();
    const search = filters?.search?.trim().slice(0, 120) || '';
    const isPhoneLike = search.replace(/\D/g, '').length >= 6;
    const rows = await this.prisma.lead.findMany({
      where: {
        businessId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.contactable !== undefined
          ? { isContactable: filters.contactable }
          : {}),
        ...(search
          ? isPhoneLike
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              }
            : { name: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        conversation: { select: conversationSelect },
        followUps: {
          where: { status: { in: ['pending', 'review'] } },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return Promise.all(rows.map((row) => this.toListItem(row)));
  }

  async getById(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const lead = await this.prisma.lead.findFirst({
      where: { id, businessId },
      include: {
        conversation: { select: conversationSelect },
        user: { include: { status: true } },
        followUps: { orderBy: { scheduledAt: 'desc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 80 },
      },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const contact = await this.contactability.resolve({
      businessId,
      phone: lead.phone,
      email: lead.email,
      conversation: lead.conversation
        ? {
            channel: lead.conversation.channel,
            contactPhone: lead.conversation.contactPhone,
          }
        : null,
    });
    return {
      ...lead,
      channel: lead.conversation?.channel ?? lead.source ?? null,
      isContactable: contact.isContactable,
      contactChannels: contact.channels,
      missingFields: contact.missingFields,
    };
  }

  async update(
    id: string,
    input: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      message?: string | null;
      interest?: string | null;
      objections?: string | null;
      status?: string;
    },
  ) {
    const current = await this.getById(id);
    if (input.status && !isLeadStatus(input.status)) {
      throw new BadRequestException('Estado de lead inválido');
    }
    const contact = await this.contactability.resolve({
      businessId: current.businessId,
      phone: input.phone !== undefined ? input.phone : current.phone,
      email: input.email !== undefined ? input.email : current.email,
      conversation: current.conversation
        ? {
            channel: current.conversation.channel,
            contactPhone: current.conversation.contactPhone,
          }
        : null,
    });
    const nextStatus = input.status ?? current.status;
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name?.trim() || null : undefined,
        email: input.email !== undefined ? input.email?.trim() || null : undefined,
        phone: input.phone !== undefined ? input.phone?.trim() || null : undefined,
        message:
          input.message !== undefined ? input.message?.trim() || null : undefined,
        interest:
          input.interest !== undefined ? input.interest?.trim() || null : undefined,
        objections:
          input.objections !== undefined
            ? input.objections?.trim() || null
            : undefined,
        status: nextStatus,
        isContactable: contact.isContactable,
        preferredChannel: contact.channels[0] || current.preferredChannel,
      },
    });
    if (input.status && input.status !== current.status) {
      await this.events.append({
        businessId: current.businessId,
        leadId: id,
        type: 'status_changed',
        actor: 'admin',
        payload: { from: current.status, to: input.status },
      });
      if (TERMINAL_LEAD_STATUSES.includes(input.status as LeadStatus)) {
        await this.followUps.cancelPendingAuto(
          current.businessId,
          id,
          'status_closed',
        );
      }
      if (input.status === 'interested') {
        await this.followUps.scheduleAutoSequence(current.businessId, id);
      }
    }
    return updated;
  }

  async findByConversation(businessId: string, conversationId: string) {
    return this.prisma.lead.findFirst({
      where: { businessId, conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markLost(id: string, reason?: string) {
    const updated = await this.update(id, {
      status: 'lost',
      objections: reason,
    });
    if (reason) {
      await this.prisma.lead.update({
        where: { id },
        data: { lostReason: reason },
      });
    }
    return updated;
  }

  async convert(id: string, source = 'manual') {
    const businessId = await this.businesses.getCurrentId();
    await this.followUps.cancelPendingAuto(businessId, id, 'converted');
    return this.conversion.convert({
      businessId,
      leadId: id,
      source,
      actor: 'admin',
    });
  }

  async recordInbound(businessId: string, conversationId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { businessId, conversationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead || TERMINAL_LEAD_STATUSES.includes(lead.status as LeadStatus)) {
      return;
    }
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastInboundAt: new Date(),
        status: lead.status === 'new' ? 'contacted' : lead.status,
      },
    });
    await this.followUps.cancelPendingAuto(businessId, lead.id, 'inbound_reply');
  }

  private nextStatus(
    current: string | undefined,
    requested: LeadStatus | null,
    hasConversation: boolean,
    hasInterest: boolean,
  ): LeadStatus {
    if (current && TERMINAL_LEAD_STATUSES.includes(current as LeadStatus)) {
      return current as LeadStatus;
    }
    if (requested) return requested;
    if (hasInterest) return 'interested';
    if (current === 'interested') return 'interested';
    if (hasConversation || current === 'contacted') return 'contacted';
    return 'new';
  }

  private async toListItem(row: {
    id: string;
    businessId: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    message: string | null;
    source: string | null;
    status: string;
    interest: string | null;
    isContactable: boolean;
    conversationId: string | null;
    createdAt: Date;
    lastContactedAt: Date | null;
    lastInboundAt: Date | null;
    conversation: {
      id: string;
      channel: string;
      contactName: string | null;
      contactPhone: string | null;
      lastMessageAt: Date | null;
    } | null;
    followUps: Array<{ scheduledAt: Date }>;
  }): Promise<LeadListItem> {
    const contact = await this.contactability.resolve({
      businessId: row.businessId,
      phone: row.phone,
      email: row.email,
      conversation: row.conversation
        ? {
            channel: row.conversation.channel,
            contactPhone: row.conversation.contactPhone,
          }
        : null,
    });
    const lastActivity =
      row.conversation?.lastMessageAt ||
      row.lastInboundAt ||
      row.lastContactedAt ||
      row.createdAt;
    return {
      id: row.id,
      name: row.name || row.conversation?.contactName || null,
      email: row.email,
      phone: row.phone,
      message: row.message,
      source: row.source,
      channel: row.conversation?.channel ?? row.source ?? null,
      conversationId: row.conversationId ?? row.conversation?.id ?? null,
      status: row.status,
      interest: row.interest,
      isContactable: contact.isContactable,
      contactChannels: contact.channels,
      nextFollowUpAt: row.followUps[0]?.scheduledAt.toISOString() ?? null,
      lastActivityAt: lastActivity.toISOString(),
      createdAt: row.createdAt,
    };
  }
}
