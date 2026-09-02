import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ADMIN_ONLY_CONVERSATION_CHANNELS } from '../common/constants';
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
      this.prisma.conversation.count({
        where: this.customerConversationFilter(),
      }),
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

  async dashboard(month?: string) {
    const business = await this.businesses.getCurrent();
    const businessId = business.id;
    const zone = business.timezone || 'America/Argentina/Buenos_Aires';
    const now = DateTime.now().setZone(zone);
    const selectedMonth = parseMonthParam(month, zone, now);
    const startOfDay = now.startOf('day').toUTC().toJSDate();
    const endOfDay = now.endOf('day').toUTC().toJSDate();
    const startOfWeek = now.startOf('week').toUTC().toJSDate();
    const endOfWeek = now.endOf('week').toUTC().toJSDate();

    const startOfMonth = selectedMonth.startOf('month').toUTC().toJSDate();
    const endOfMonth = selectedMonth.endOf('month').toUTC().toJSDate();
    const prevMonth = selectedMonth.minus({ months: 1 });
    const startOfPrevMonth = prevMonth.startOf('month').toUTC().toJSDate();
    const endOfPrevMonth = prevMonth.endOf('month').toUTC().toJSDate();
    const customerLead = this.customerLeadFilter();
    const visibleConversation = {
      businessId,
      hiddenAt: null,
      ...this.customerConversationFilter(),
    };

    const [
      conversationsToday,
      conversationsWeek,
      openByStatus,
      unreadAgg,
      appointmentsToday,
      appointmentsWeek,
      leadsWeek,
      executionsWeek,
      latency,
      recentConversations,
      upcomingAppointments,
      contentGeneratedMonth,
      contentAssetsByType,
      monthConversations,
      monthLeads,
      monthClients,
      prevLeads,
      prevClients,
      prevConversations,
      servicePasses,
      nextAppointmentsRaw,
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
          ...customerLead,
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
          conversation: this.customerConversationFilter(),
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
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          status: { not: 'FAILED' },
        },
      }),
      this.prisma.contentAsset.groupBy({
        by: ['type'],
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          content: {
            businessId,
            status: { not: 'FAILED' },
          },
        },
        _count: true,
      }),
      this.prisma.conversation.findMany({
        where: {
          ...visibleConversation,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        select: { createdAt: true, channel: true },
      }),
      this.prisma.lead.findMany({
        where: {
          businessId,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          ...customerLead,
        },
        select: {
          createdAt: true,
          source: true,
          conversation: { select: { channel: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          businessId,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        select: { createdAt: true },
      }),
      this.prisma.lead.count({
        where: {
          businessId,
          createdAt: { gte: startOfPrevMonth, lte: endOfPrevMonth },
          ...customerLead,
        },
      }),
      this.prisma.user.count({
        where: {
          businessId,
          createdAt: { gte: startOfPrevMonth, lte: endOfPrevMonth },
        },
      }),
      this.prisma.conversation.count({
        where: {
          ...visibleConversation,
          createdAt: { gte: startOfPrevMonth, lte: endOfPrevMonth },
        },
      }),
      this.prisma.servicePass.findMany({
        where: { businessId },
        include: {
          service: { select: { name: true } },
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId,
          status: { in: ['pending', 'confirmed'] },
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: 'asc' },
        take: 20,
        include: { service: { select: { name: true } } },
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

    const leadsMonth = monthLeads.length;
    const newClientsMonth = monthClients.length;
    const conversationsMonth = monthConversations.length;
    const daily = buildDailySeries(
      selectedMonth,
      zone,
      monthLeads,
      monthClients,
      monthConversations,
    );
    const channels = buildChannelStats(monthConversations, monthLeads);
    const topChannel = channels.reduce<(typeof channels)[number] | null>(
      (best, row) => {
        if (row.leads <= 0) return best;
        if (!best) return row;
        if (row.leads !== best.leads) return row.leads > best.leads ? row : best;
        if (row.conversations !== best.conversations) {
          return row.conversations > best.conversations ? row : best;
        }
        return best;
      },
      null,
    );

    // Packs KPIs: por vencer (1-2 clases) y vencidos (0)
    const packsByUser = new Map<string, { name: string | null; phone: string | null; remaining: number; packs: typeof servicePasses }>();
    for (const pass of servicePasses) {
      const key = pass.userId;
      const existing = packsByUser.get(key);
      const remaining = Math.max(0, pass.sessionsPaid - pass.sessionsUsed);
      const isActive = pass.status === 'ACTIVE' && remaining > 0;
      const entry = existing ?? { name: pass.user?.name ?? null, phone: pass.user?.phone ?? null, remaining: 0, packs: [] as typeof servicePasses };
      if (isActive) entry.remaining += remaining;
      entry.packs.push(pass);
      packsByUser.set(key, entry);
    }
    // También usuarios sin passes no entran. Para vencidos: incluir usuarios con passes pero remaining 0
    const expiring: Array<{ userId: string; name: string | null; phone: string | null; remaining: number; packName: string | null }> = [];
    const expired: Array<{ userId: string; name: string | null; phone: string | null; remaining: number }> = [];
    for (const [userId, info] of packsByUser.entries()) {
      if (info.remaining > 0 && info.remaining <= 2) {
        const packName = info.packs.find((p) => p.status === 'ACTIVE' && Math.max(0, p.sessionsPaid - p.sessionsUsed) > 0)?.service?.name ?? null;
        expiring.push({ userId, name: info.name, phone: info.phone, remaining: info.remaining, packName });
      } else if (info.remaining === 0) {
        // solo si tuvo al menos un pack (ya está en mapa)
        expired.push({ userId, name: info.name, phone: info.phone, remaining: 0 });
      }
    }
    expiring.sort((a, b) => a.remaining - b.remaining);
    expired.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    // Próxima clase: primer grupo de appointments futuros por startsAt
    let nextClass: { startsAt: string; endsAt: string; serviceName: string | null; attendees: Array<{ name: string | null; phone: string | null }> } | null = null;
    if (nextAppointmentsRaw.length) {
      const firstStart = nextAppointmentsRaw[0].startsAt.toISOString();
      const group = nextAppointmentsRaw.filter((a) => a.startsAt.toISOString() === firstStart);
      nextClass = {
        startsAt: group[0].startsAt.toISOString(),
        endsAt: group[0].endsAt.toISOString(),
        serviceName: group[0].service?.name ?? null,
        attendees: group.map((a) => ({ name: a.contactName, phone: a.contactPhone })),
      };
    }

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
        month: selectedMonth.toFormat('yyyy-MM'),
        monthStart: selectedMonth.startOf('month').toISODate(),
        monthEnd: selectedMonth.endOf('month').toISODate(),
        monthLabel: formatMonthLabel(selectedMonth),
        availableMonths: availableMonthOptions(now),
      },
      metrics: {
        conversationsToday,
        conversationsWeek,
        conversationsMonth,
        conversationsMonthDelta: monthDelta(conversationsMonth, prevConversations),
        openConversations,
        handoffsOpen,
        unreadMessages: unreadAgg._sum.unreadCount ?? 0,
        appointmentsToday,
        appointmentsWeek,
        leadsWeek,
        leadsMonth,
        leadsMonthDelta: monthDelta(leadsMonth, prevLeads),
        newClientsMonth,
        newClientsMonthDelta: monthDelta(newClientsMonth, prevClients),
        topChannel: topChannel?.channel ?? null,
        executionsWeek: executionsWeek._count,
        inputTokensWeek: executionsWeek._sum.inputTokens ?? 0,
        outputTokensWeek: executionsWeek._sum.outputTokens ?? 0,
        estimatedCostWeek: executionsWeek._sum.estimatedCost ?? 0,
        avgLatencyMs: Math.round(
          latency._avg.latencyMs ?? executionsWeek._avg.durationMs ?? 0,
        ),
        contentGeneratedMonth,
        contentPhotosMonth: assetCounts.IMAGE ?? 0,
        contentVideosMonth: assetCounts.VIDEO ?? 0,
      },
      statusMix: openByStatus.map((row) => ({
        status: row.status,
        count: row._count,
      })),
      channelMix: channels.map((row) => ({
        channel: row.channel,
        count: row.conversations,
        leads: row.leads,
        share: row.share,
      })),
      channels,
      daily,
      recentConversations,
      upcomingAppointments,
      packs: {
        expiringCount: expiring.length,
        expiring,
        expiredCount: expired.length,
        expired,
      },
      nextClass,
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
        where: {
          businessId,
          ...this.customerConversationFilter(),
        },
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

  /** Excluye playground de KPIs y listados analíticos. WEB (widget) sí cuenta. */
  private customerConversationFilter() {
    return {
      channel: {
        notIn: [...ADMIN_ONLY_CONVERSATION_CHANNELS],
      },
    };
  }

  private customerLeadFilter() {
    return {
      OR: [
        { conversationId: null },
        {
          conversation: {
            channel: { notIn: [...ADMIN_ONLY_CONVERSATION_CHANNELS] },
          },
        },
      ],
    };
  }
}

const CONTACT_CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'WEB', 'VOICE'] as const;

function parseMonthParam(
  month: string | undefined,
  zone: string,
  now: DateTime,
): DateTime {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const parsed = DateTime.fromISO(`${month}-01`, { zone });
    if (parsed.isValid) return parsed.startOf('month');
  }
  return now.startOf('month');
}

function availableMonthOptions(now: DateTime): Array<{ value: string; label: string }> {
  return Array.from({ length: 18 }, (_, index) => {
    const month = now.minus({ months: index }).startOf('month');
    return {
      value: month.toFormat('yyyy-MM'),
      label: formatMonthLabel(month),
    };
  });
}

function formatMonthLabel(month: DateTime): string {
  const label = month.setLocale('es').toFormat('LLLL yyyy');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function dayKey(value: Date, zone: string): string {
  return DateTime.fromJSDate(value).setZone(zone).toISODate() ?? '';
}

function normalizeChannel(value?: string | null): (typeof CONTACT_CHANNELS)[number] | null {
  const raw = (value ?? '').trim().toUpperCase();
  if (!raw || raw === 'PLAYGROUND' || raw.includes('PLAYGROUND')) return null;
  if (raw === 'WHATSAPP' || raw.includes('WHATSAPP') || raw.includes('WAHA')) {
    return 'WHATSAPP';
  }
  if (raw === 'FACEBOOK' || raw.includes('FACEBOOK') || raw.includes('MESSENGER')) {
    return 'FACEBOOK';
  }
  if (raw === 'INSTAGRAM' || raw.includes('INSTAGRAM')) {
    return 'INSTAGRAM';
  }
  if (raw === 'VOICE' || raw === 'CALL' || raw.includes('VOICE')) return 'VOICE';
  if (raw === 'WEB' || raw === 'WEBSITE' || raw.includes('WEB')) return 'WEB';
  return null;
}

function buildDailySeries(
  month: DateTime,
  zone: string,
  leads: Array<{ createdAt: Date }>,
  clients: Array<{ createdAt: Date }>,
  conversations: Array<{ createdAt: Date }>,
): Array<{ date: string; leads: number; clients: number; conversations: number }> {
  const daysInMonth = month.daysInMonth ?? 30;
  const buckets = new Map<string, { leads: number; clients: number; conversations: number }>();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = month.set({ day }).toISODate();
    if (date) buckets.set(date, { leads: 0, clients: 0, conversations: 0 });
  }
  for (const row of leads) {
    const key = dayKey(row.createdAt, zone);
    const bucket = buckets.get(key);
    if (bucket) bucket.leads += 1;
  }
  for (const row of clients) {
    const key = dayKey(row.createdAt, zone);
    const bucket = buckets.get(key);
    if (bucket) bucket.clients += 1;
  }
  for (const row of conversations) {
    const key = dayKey(row.createdAt, zone);
    const bucket = buckets.get(key);
    if (bucket) bucket.conversations += 1;
  }
  return [...buckets.entries()].map(([date, counts]) => ({ date, ...counts }));
}

function buildChannelStats(
  conversations: Array<{ channel: string }>,
  leads: Array<{ source: string | null; conversation: { channel: string } | null }>,
): Array<{
  channel: string;
  conversations: number;
  leads: number;
  share: number;
  conversion: number;
}> {
  const stats = Object.fromEntries(
    CONTACT_CHANNELS.map((channel) => [
      channel,
      { channel, conversations: 0, leads: 0, share: 0, conversion: 0 },
    ]),
  ) as Record<
    string,
    {
      channel: string;
      conversations: number;
      leads: number;
      share: number;
      conversion: number;
    }
  >;

  for (const row of conversations) {
    const channel = normalizeChannel(row.channel);
    if (!channel) continue;
    stats[channel].conversations += 1;
  }
  for (const row of leads) {
    const channel = normalizeChannel(row.conversation?.channel ?? row.source);
    if (!channel) continue;
    stats[channel].leads += 1;
  }

  const totalLeads = CONTACT_CHANNELS.reduce(
    (sum, channel) => sum + stats[channel].leads,
    0,
  );
  return CONTACT_CHANNELS.map((channel) => {
    const row = stats[channel];
    row.share = totalLeads > 0 ? Math.round((row.leads / totalLeads) * 100) : 0;
    row.conversion =
      row.conversations > 0
        ? Math.round((row.leads / row.conversations) * 100)
        : 0;
    return row;
  });
}
