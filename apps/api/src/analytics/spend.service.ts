import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

export interface SpendBucket {
  cost: number;
  calls: number;
  tokens: number;
}

export interface SpendBreakdown {
  label: string;
  day: SpendBucket;
  month: SpendBucket;
}

export interface SpendServiceRow {
  id: string;
  name: string;
  envKey: string;
  configured: boolean;
  day: SpendBucket;
  month: SpendBucket;
  breakdown: SpendBreakdown[];
}

export interface SpendReport {
  currency: 'USD';
  period: {
    today: string;
    month: string;
    monthLabel: string;
    availableMonths: Array<{ value: string; label: string }>;
  };
  totals: {
    day: number;
    month: number;
  };
  services: SpendServiceRow[];
  note: string;
}

interface CatalogService {
  id: string;
  name: string;
  envKeys: string[];
  aliases: string[];
}

const CATALOG: CatalogService[] = [
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    envKeys: ['OPENAI_API_KEY'],
    aliases: ['openai', 'gpt'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
    aliases: ['gemini', 'google'],
  },
  {
    id: 'veo',
    name: 'Google Veo',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
    aliases: ['veo'],
  },
  {
    id: 'kie',
    name: 'Kie (video)',
    envKeys: ['KIE_API_KEY'],
    aliases: ['kie'],
  },
  {
    id: 'fal',
    name: 'fal.ai',
    envKeys: ['FAL_KEY', 'FAL_API_KEY'],
    aliases: ['fal'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    aliases: ['anthropic', 'claude'],
  },
];

const STAGE_LABEL: Record<string, string> = {
  agent: 'Chat del agente',
  brief: 'Guion',
  strategy: 'Estrategia de contenido',
  image: 'Imágenes',
  video: 'Video',
  'video-edit': 'Edición local',
  failed: 'Intentos fallidos',
};

@Injectable()
export class SpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly config: ConfigService,
  ) {}

  async report(month?: string): Promise<SpendReport> {
    const business = await this.businesses.getCurrent();
    const zone = business.timezone || 'America/Argentina/Buenos_Aires';
    const now = DateTime.now().setZone(zone);
    const selectedMonth = parseMonthParam(month, zone, now);
    const startOfDay = now.startOf('day').toUTC().toJSDate();
    const endOfDay = now.endOf('day').toUTC().toJSDate();
    const startOfMonth = selectedMonth.startOf('month').toUTC().toJSDate();
    const endOfMonth = selectedMonth.endOf('month').toUTC().toJSDate();

    const [agentDay, agentMonth, contentDay, contentMonth] = await Promise.all([
      this.prisma.agentExecution.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.agentExecution.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.contentGenerationExecution.groupBy({
        by: ['provider', 'stage'],
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.contentGenerationExecution.groupBy({
        by: ['provider', 'stage'],
        where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
    ]);

    const rows = new Map<string, SpendServiceRow>();
    for (const catalog of CATALOG) {
      rows.set(catalog.id, emptyRow(catalog, this.hasAnyKey(catalog.envKeys)));
    }

    for (const row of agentDay) {
      addUsage(rows, row.provider, 'agent', 'day', {
        cost: num(row._sum.estimatedCost),
        calls: row._count,
        tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
      });
    }
    for (const row of agentMonth) {
      addUsage(rows, row.provider, 'agent', 'month', {
        cost: num(row._sum.estimatedCost),
        calls: row._count,
        tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
      });
    }
    for (const row of contentDay) {
      addUsage(rows, row.provider, row.stage, 'day', {
        cost: num(row._sum.estimatedCost),
        calls: row._count,
        tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
      });
    }
    for (const row of contentMonth) {
      addUsage(rows, row.provider, row.stage, 'month', {
        cost: num(row._sum.estimatedCost),
        calls: row._count,
        tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
      });
    }

    const services = [...rows.values()]
      .filter((row) => row.configured || row.day.cost > 0 || row.month.cost > 0)
      .map((row) => ({
        ...row,
        day: roundBucket(row.day),
        month: roundBucket(row.month),
        breakdown: row.breakdown
          .filter((item) => item.day.cost > 0 || item.month.cost > 0)
          .map((item) => ({
            ...item,
            day: roundBucket(item.day),
            month: roundBucket(item.month),
          })),
      }))
      .sort((a, b) => b.month.cost - a.month.cost || a.name.localeCompare(b.name));

    const totals = {
      day: roundMoney(services.reduce((sum, row) => sum + row.day.cost, 0)),
      month: roundMoney(services.reduce((sum, row) => sum + row.month.cost, 0)),
    };

    return {
      currency: 'USD',
      period: {
        today: now.toISODate() ?? '',
        month: selectedMonth.toFormat('yyyy-MM'),
        monthLabel: formatMonthLabel(selectedMonth),
        availableMonths: availableMonthOptions(now),
      },
      totals,
      services,
      note: 'Estimado a partir del uso registrado en la plataforma. No reemplaza la factura del proveedor. Transcripciones y embeddings de OpenAI no se itemizan aparte.',
    };
  }

  private hasAnyKey(keys: string[]): boolean {
    return keys.some((key) => Boolean(this.config.get<string>(key)?.trim()));
  }
}

function emptyBucket(): SpendBucket {
  return { cost: 0, calls: 0, tokens: 0 };
}

function emptyRow(catalog: CatalogService, configured: boolean): SpendServiceRow {
  return {
    id: catalog.id,
    name: catalog.name,
    envKey: catalog.envKeys[0] ?? '',
    configured,
    day: emptyBucket(),
    month: emptyBucket(),
    breakdown: [],
  };
}

function normalizeProvider(value?: string | null): string {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return 'other';
  for (const catalog of CATALOG) {
    if (catalog.aliases.some((alias) => raw === alias || raw.includes(alias))) {
      return catalog.id;
    }
  }
  return raw.replace(/[^a-z0-9]+/g, '-');
}

function addUsage(
  rows: Map<string, SpendServiceRow>,
  provider: string | null,
  stage: string,
  period: 'day' | 'month',
  usage: SpendBucket,
) {
  const id = normalizeProvider(provider);
  let row = rows.get(id);
  if (!row) {
    row = {
      id,
      name: id,
      envKey: '',
      configured: false,
      day: emptyBucket(),
      month: emptyBucket(),
      breakdown: [],
    };
    rows.set(id, row);
  }
  mergeBucket(row[period], usage);
  const label = STAGE_LABEL[stage] ?? stage;
  let item = row.breakdown.find((entry) => entry.label === label);
  if (!item) {
    item = { label, day: emptyBucket(), month: emptyBucket() };
    row.breakdown.push(item);
  }
  mergeBucket(item[period], usage);
}

function mergeBucket(target: SpendBucket, extra: SpendBucket) {
  target.cost += extra.cost;
  target.calls += extra.calls;
  target.tokens += extra.tokens;
}

function num(value: unknown): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(6));
}

function roundBucket(bucket: SpendBucket): SpendBucket {
  return {
    cost: roundMoney(bucket.cost),
    calls: bucket.calls,
    tokens: bucket.tokens,
  };
}

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
