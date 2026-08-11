import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  async overview() {
    const [businesses, conversations, executions, leads] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.conversation.count(),
      this.prisma.agentExecution.aggregate({
        _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
        _count: true,
      }),
      this.prisma.lead.count(),
    ]);

    return {
      businesses,
      conversations,
      leads,
      executions: executions._count,
      inputTokens: executions._sum.inputTokens ?? 0,
      outputTokens: executions._sum.outputTokens ?? 0,
      estimatedCost: executions._sum.estimatedCost ?? 0,
    };
  }

  async dashboard() {
    const business = await this.businesses.getCurrent();
    const businessId = business.id;
    const zone = business.timezone || 'America/Argentina/Buenos_Aires';
    const now = DateTime.now().setZone(zone);
    const startOfDay = now.startOf('day').toUTC().toJSDate();
    const endOfDay = now.endOf('day').toUTC().toJSDate();
    const startOfWeek = now.startOf('week').toUTC().toJSDate(); // Monday
    const endOfWeek = now.endOf('week').toUTC().toJSDate();

    const startOfMonth = now.startOf('month').toUTC().toJSDate();
    const visibleConversation = { businessId, hiddenAt: null };

    const [
      conversationsToday,
      conversationsWeek,
      openByStatus,
      unreadAgg,
      channelMix,
      appointmentsToday,
      appointmentsWeek,
      leadsWeek,
      executionsWeek,
      latency,
      recentConversations,
      upcomingAppointments,
      contentGeneratedMonth,
      contentAssetsByType,
    ] = await Promise.all([
      this.prisma.conversation.count({
        where: {
          ...visibleConversation,
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
      }),
      this.prisma.conversation.count({
        where: {
          ...visibleConversation,
          createdAt: { gte: startOfWeek, lte: endOfWeek },
        },
      }),
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: visibleConversation,
        _count: true,
      }),
      this.prisma.conversation.aggregate({
        where: visibleConversation,
        _sum: { unreadCount: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['channel'],
        where: visibleConversation,
        _count: true,
      }),
      this.prisma.appointment.count({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: startOfDay, lte: endOfDay },
        },
      }),
      this.prisma.appointment.count({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: startOfWeek, lte: endOfWeek },
        },
      }),
      this.prisma.lead.count({
        where: {
          businessId,
          createdAt: { gte: startOfWeek, lte: endOfWeek },
        },
      }),
      this.prisma.agentExecution.aggregate({
        where: {
          businessId,
          createdAt: { gte: startOfWeek, lte: endOfWeek },
        },
        _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
        _count: true,
        _avg: { durationMs: true },
      }),
      this.prisma.message.aggregate({
        where: {
          businessId,
          sender: 'AI',
          latencyMs: { not: null },
          createdAt: { gte: startOfWeek, lte: endOfWeek },
        },
        _avg: { latencyMs: true },
      }),
      this.prisma.conversation.findMany({
        where: visibleConversation,
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          status: true,
          channel: true,
          contactName: true,
          contactPhone: true,
          unreadCount: true,
          lastMessageAt: true,
          lastMessagePreview: true,
          lastMessageSender: true,
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: startOfDay },
        },
        orderBy: { startsAt: 'asc' },
        take: 8,
        include: {
          service: { select: { id: true, name: true } },
        },
      }),
      this.prisma.generatedContent.count({
        where: {
          businessId,
          createdAt: { gte: startOfMonth },
          status: { not: 'FAILED' },
        },
      }),
      this.prisma.contentAsset.groupBy({
        by: ['type'],
        where: {
          createdAt: { gte: startOfMonth },
          content: {
            businessId,
            status: { not: 'FAILED' },
          },
        },
        _count: true,
      }),
    ]);

    const statusCounts = Object.fromEntries(
      openByStatus.map((row) => [row.status, row._count]),
    ) as Record<string, number>;

    const handoffsOpen =
      (statusCounts.WAITING_HUMAN ?? 0) + (statusCounts.HUMAN ?? 0);
    const openConversations =
      (statusCounts.AI ?? 0) +
      (statusCounts.WAITING_HUMAN ?? 0) +
      (statusCounts.HUMAN ?? 0);

    const assetCounts = Object.fromEntries(
      contentAssetsByType.map((row) => [row.type, row._count]),
    ) as Record<string, number>;

    return {
      business: {
        id: business.id,
        name: business.name,
        timezone: zone,
      },
      period: {
        today: now.toISODate(),
        weekStart: now.startOf('week').toISODate(),
        weekEnd: now.endOf('week').toISODate(),
      },
      metrics: {
        conversationsToday,
        conversationsWeek,
        openConversations,
        handoffsOpen,
        unreadMessages: unreadAgg._sum.unreadCount ?? 0,
        appointmentsToday,
        appointmentsWeek,
        leadsWeek,
        executionsWeek: executionsWeek._count,
        inputTokensWeek: executionsWeek._sum.inputTokens ?? 0,
        outputTokensWeek: executionsWeek._sum.outputTokens ?? 0,
        estimatedCostWeek: executionsWeek._sum.estimatedCost ?? 0,
        avgLatencyMs: Math.round(
          latency._avg.latencyMs ??
            executionsWeek._avg.durationMs ??
            0,
        ),
        contentGeneratedMonth,
        contentPhotosMonth: assetCounts.IMAGE ?? 0,
        contentVideosMonth: assetCounts.VIDEO ?? 0,
      },
      statusMix: openByStatus.map((row) => ({
        status: row.status,
        count: row._count,
      })),
      channelMix: channelMix.map((row) => ({
        channel: row.channel,
        count: row._count,
      })),
      recentConversations,
      upcomingAppointments,
    };
  }

  async byBusiness(businessId: string) {
    const [executions, conversations, toolExecutions] = await Promise.all([
      this.prisma.agentExecution.aggregate({
        where: { businessId },
        _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
        _count: true,
        _avg: { durationMs: true, steps: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true,
      }),
      this.prisma.toolExecution.groupBy({
        by: ['tool', 'success'],
        where: { businessId },
        _count: true,
      }),
    ]);

    return { executions, conversations, toolExecutions };
  }
}
