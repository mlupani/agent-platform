import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';
import { LeadFollowUpGeneratorService } from './lead-follow-up-generator.service';
import { LeadFollowUpSenderService } from './lead-follow-up-sender.service';
import { LeadFollowUpService } from './lead-follow-up.service';
import { LeadLifecycleService } from './lead-lifecycle.service';
import { LEAD_FOLLOW_UP_TICK_LOCK } from './lead-follow-up.queue';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class LeadFollowUpProcessorService {
  private readonly logger = new Logger(LeadFollowUpProcessorService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly followUps: LeadFollowUpService,
    private readonly lifecycle: LeadLifecycleService,
    private readonly generator: LeadFollowUpGeneratorService,
    private readonly sender: LeadFollowUpSenderService,
  ) {}

  async processDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let locked = false;
    try {
      locked = await this.redis.acquireLock(LEAD_FOLLOW_UP_TICK_LOCK, 50);
      if (!locked) return 0;
      const due = await this.followUps.duePending(30);
      let handled = 0;
      for (const item of due) {
        try {
          handled += (await this.handleOne(item.id)) ? 1 : 0;
        } catch (error) {
          this.logger.warn(
            `Follow-up ${item.id} falló: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
          await this.prisma.leadFollowUp.update({
            where: { id: item.id },
            data: { status: 'failed' },
          });
        }
      }
      return handled;
    } finally {
      if (locked) await this.redis.releaseLock(LEAD_FOLLOW_UP_TICK_LOCK);
      this.running = false;
    }
  }

  private async handleOne(id: string): Promise<boolean> {
    const followUp = await this.prisma.leadFollowUp.findUnique({
      where: { id },
      include: { lead: { include: { conversation: true } } },
    });
    if (!followUp || followUp.status !== 'pending') return false;
    if (followUp.lead.conversation?.channel === 'PLAYGROUND') {
      await this.prisma.leadFollowUp.update({
        where: { id },
        data: { status: 'skipped', cancelReason: 'playground' },
      });
      return false;
    }
    const config = await this.lifecycle.getPublic(followUp.businessId);
    const timezone = config.timezone || 'UTC';
    const adjusted = this.followUps.nextWindow(
      followUp.scheduledAt,
      timezone,
      config.quietHoursStart,
      config.quietHoursEnd,
    );
    if (adjusted.getTime() > Date.now() + 30_000) {
      await this.prisma.leadFollowUp.update({
        where: { id },
        data: { scheduledAt: adjusted },
      });
      return false;
    }

    if (config.sendMode === 'reminder_only') {
      return false;
    }

    if (followUp.lead.conversationId) {
      await this.generator.maybeWriteSummary(
        followUp.lead.conversationId,
        followUp.businessId,
      );
    }

    await this.prisma.leadFollowUp.update({
      where: { id },
      data: { status: 'generating' },
    });
    const draft = await this.generator.generate(id);
    await this.prisma.leadFollowUp.update({
      where: { id },
      data: {
        draftMessage: draft,
        status: config.sendMode === 'review' ? 'review' : 'pending',
      },
    });

    if (config.sendMode === 'review') return true;
    await this.sender.send(id, draft);
    if (
      followUp.source === 'auto' &&
      followUp.attemptNumber >= config.maxAttempts
    ) {
      await this.prisma.lead.update({
        where: { id: followUp.leadId },
        data: { status: 'inactive' },
      });
    }
    return true;
  }
}
