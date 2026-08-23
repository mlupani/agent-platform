import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadEventsService } from './lead-events.service';
import { LeadLifecycleService } from './lead-lifecycle.service';
import {
  TERMINAL_LEAD_STATUSES,
  isFollowUpObjective,
  type LeadFollowUpObjective,
  type LeadFollowUpSource,
} from './lead.constants';

@Injectable()
export class LeadFollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: LeadEventsService,
    private readonly lifecycle: LeadLifecycleService,
  ) {}

  list(businessId: string, leadId: string) {
    return this.prisma.leadFollowUp.findMany({
      where: { businessId, leadId },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async create(input: {
    businessId: string;
    leadId: string;
    source: LeadFollowUpSource;
    objective: string;
    objectiveNote?: string | null;
    scheduledAt: Date;
    attemptNumber?: number;
    actor?: 'agent' | 'admin' | 'system';
  }) {
    const lead = await this.requireLead(input.businessId, input.leadId);
    if (TERMINAL_LEAD_STATUSES.includes(lead.status as never)) {
      throw new BadRequestException(
        'No se puede programar un seguimiento en un lead cerrado.',
      );
    }
    const objective = this.normalizeObjective(input.objective);
    const created = await this.prisma.leadFollowUp.create({
      data: {
        businessId: input.businessId,
        leadId: input.leadId,
        conversationId: lead.conversationId,
        source: input.source,
        objective,
        objectiveNote: input.objectiveNote?.trim() || null,
        scheduledAt: input.scheduledAt,
        attemptNumber: input.attemptNumber ?? 1,
        status: 'pending',
      },
    });
    await this.events.append({
      businessId: input.businessId,
      leadId: input.leadId,
      type: 'follow_up_scheduled',
      actor: input.actor ?? 'system',
      payload: {
        followUpId: created.id,
        source: input.source,
        scheduledAt: created.scheduledAt.toISOString(),
      },
    });
    return created;
  }

  async reschedule(
    businessId: string,
    leadId: string,
    followUpId: string,
    scheduledAt: Date,
  ) {
    const followUp = await this.requireFollowUp(businessId, leadId, followUpId);
    if (!['pending', 'review', 'failed'].includes(followUp.status)) {
      throw new BadRequestException('Ese seguimiento ya no se puede reprogramar.');
    }
    const updated = await this.prisma.leadFollowUp.update({
      where: { id: followUp.id },
      data: {
        scheduledAt,
        status: 'pending',
        cancelReason: null,
        cancelledAt: null,
      },
    });
    await this.events.append({
      businessId,
      leadId,
      type: 'follow_up_rescheduled',
      actor: 'admin',
      payload: { followUpId, scheduledAt: scheduledAt.toISOString() },
    });
    return updated;
  }

  async cancel(
    businessId: string,
    leadId: string,
    followUpId: string,
    reason: string,
    actor: 'agent' | 'admin' | 'system' = 'admin',
  ) {
    const followUp = await this.requireFollowUp(businessId, leadId, followUpId);
    if (['sent', 'cancelled'].includes(followUp.status)) return followUp;
    const updated = await this.prisma.leadFollowUp.update({
      where: { id: followUp.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });
    await this.events.append({
      businessId,
      leadId,
      type: 'follow_up_cancelled',
      actor,
      payload: { followUpId, reason },
    });
    return updated;
  }

  async cancelPendingAuto(businessId: string, leadId: string, reason: string) {
    const pending = await this.prisma.leadFollowUp.findMany({
      where: {
        businessId,
        leadId,
        source: 'auto',
        status: { in: ['pending', 'generating', 'review'] },
      },
    });
    for (const item of pending) {
      await this.cancel(businessId, leadId, item.id, reason, 'system');
    }
  }

  async scheduleAutoSequence(businessId: string, leadId: string) {
    const config = await this.lifecycle.getPublic(businessId);
    if (!config.followUpEnabled) return [];
    const lead = await this.requireLead(businessId, leadId);
    if (!lead.isContactable) return [];
    if (lead.status !== 'interested') return [];
    const conversation = lead.conversationId
      ? await this.prisma.conversation.findFirst({
          where: { id: lead.conversationId, businessId },
          select: { channel: true },
        })
      : null;
    if (conversation?.channel === 'PLAYGROUND') return [];

    const existing = await this.prisma.leadFollowUp.count({
      where: { leadId, source: 'auto', status: { not: 'cancelled' } },
    });
    if (existing > 0) return [];

    const now = DateTime.now().setZone(config.timezone || 'UTC');
    const created = [];
    for (const [index, hours] of config.followUpDelaysHours
      .slice(0, config.maxAttempts)
      .entries()) {
      created.push(
        await this.create({
          businessId,
          leadId,
          source: 'auto',
          objective: 'resume_conversation',
          scheduledAt: now.plus({ hours }).toJSDate(),
          attemptNumber: index + 1,
        }),
      );
    }
    return created;
  }

  async duePending(limit = 40) {
    return this.prisma.leadFollowUp.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: new Date() },
      },
      include: {
        lead: true,
        conversation: true,
      },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
  }

  nextWindow(scheduledAt: Date, timezone: string, start: string, end: string) {
    const zone = timezone || 'UTC';
    let cursor = DateTime.fromJSDate(scheduledAt).setZone(zone);
    for (let i = 0; i < 48; i += 1) {
      const [startH, startM] = start.split(':').map(Number);
      const [endH, endM] = end.split(':').map(Number);
      const windowStart = cursor.set({
        hour: startH || 9,
        minute: startM || 0,
        second: 0,
        millisecond: 0,
      });
      const windowEnd = cursor.set({
        hour: endH || 21,
        minute: endM || 0,
        second: 0,
        millisecond: 0,
      });
      if (cursor >= windowStart && cursor <= windowEnd) return cursor.toJSDate();
      cursor = windowEnd < cursor ? windowStart.plus({ days: 1 }) : windowStart;
    }
    return scheduledAt;
  }

  getOne(businessId: string, leadId: string, followUpId: string) {
    return this.requireFollowUp(businessId, leadId, followUpId);
  }

  private normalizeObjective(value: string): LeadFollowUpObjective | string {
    const trimmed = value.trim();
    if (!trimmed) throw new BadRequestException('El objetivo es obligatorio.');
    return isFollowUpObjective(trimmed) ? trimmed : trimmed.slice(0, 80);
  }

  private async requireLead(businessId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, businessId },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  private async requireFollowUp(
    businessId: string,
    leadId: string,
    followUpId: string,
  ) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, businessId, leadId },
    });
    if (!followUp) throw new NotFoundException('Seguimiento no encontrado');
    return followUp;
  }
}
