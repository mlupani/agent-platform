import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { slugify } from '../common/utils/slug';
import {
  DEFAULT_CONFIGURED_MESSAGES,
  GENERIC_TOOLS,
  WEEKDAY_LABELS,
  defaultWeeklyHours,
} from '../common/constants';

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Single-business: el primer (y único) negocio del deployment. */
  async getCurrent() {
    const business = await this.prisma.business.findFirst({
      orderBy: { createdAt: 'asc' },
      include: {
        agentConfigs: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        knowledgeBases: true,
        toolConfigs: true,
        businessHours: { orderBy: { dayOfWeek: 'asc' } },
        services: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        integrations: {
          select: {
            id: true,
            type: true,
            name: true,
            enabled: true,
            config: true,
            createdAt: true,
          },
        },
        automations: true,
        _count: { select: { conversations: true } },
      },
    });
    if (!business) {
      throw new NotFoundException(
        'No hay un negocio configurado. Ejecutá el seed o creá uno.',
      );
    }
    return business;
  }

  async getCurrentId(): Promise<string> {
    const business = await this.prisma.business.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!business) {
      throw new NotFoundException('No hay un negocio configurado');
    }
    return business.id;
  }

  list() {
    return this.prisma.business.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        agentConfigs: true,
        knowledgeBases: true,
        _count: { select: { conversations: true } },
      },
    });
  }

  async get(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: {
        agentConfigs: true,
        knowledgeBases: true,
        toolConfigs: true,
        businessHours: { orderBy: { dayOfWeek: 'asc' } },
        services: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        integrations: {
          select: {
            id: true,
            type: true,
            name: true,
            enabled: true,
            config: true,
            createdAt: true,
          },
        },
        automations: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async create(input: {
    name: string;
    description?: string;
    type?: string;
    timezone?: string;
    language?: string;
    systemPrompt?: string;
    personality?: string;
    model?: string;
    temperature?: number;
    tools?: string[];
    openingHours?: object;
    defaultMessages?: object;
    rules?: object;
  }) {
    const existing = await this.prisma.business.count();
    if (existing > 0) {
      throw new BadRequestException(
        'Este deployment es single-business. Editá el negocio existente.',
      );
    }

    const slugBase = slugify(input.name) || 'business';
    const slug = slugBase;
    const tools = input.tools?.length ? input.tools : [...GENERIC_TOOLS];
    const messages = {
      ...DEFAULT_CONFIGURED_MESSAGES,
      ...(input.defaultMessages ?? {}),
    };

    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          type: input.type ?? 'OTHER',
          timezone: input.timezone,
          language: input.language,
          openingHours: input.openingHours,
          defaultMessages: messages,
          rules: input.rules,
        },
      });

      await this.seedDefaultHours(tx, business.id);

      const knowledgeBase = await tx.knowledgeBase.create({
        data: {
          businessId: business.id,
          name: `${business.name} — Conocimiento`,
          description: 'Información que conoce tu asistente',
        },
      });

      await tx.agentConfig.create({
        data: {
          businessId: business.id,
          knowledgeBaseId: knowledgeBase.id,
          name: 'Asistente',
          description: input.description,
          provider: 'openai',
          model: input.model ?? 'gpt-4.1-mini',
          tone: 'professional_warm',
          customInstructions:
            input.personality ??
            'Respondé con claridad, amabilidad y sin inventar datos.',
          systemPrompt:
            input.systemPrompt ??
            `Sos el asistente virtual de ${business.name}. Respondé con claridad y usá las herramientas disponibles.`,
          personality: input.personality,
          temperature: input.temperature ?? 0.3,
          enabledTools: tools,
          enabledChannels: ['WEB', 'WHATSAPP'],
          isDefault: true,
        },
      });

      await Promise.all(
        tools.map((name) =>
          tx.toolConfig.create({
            data: {
              businessId: business.id,
              name,
              enabled: true,
              risk: this.toolRisk(name),
              requireConfirmation: name === 'sendEmail',
            },
          }),
        ),
      );

      return tx.business.findUniqueOrThrow({
        where: { id: business.id },
        include: {
          agentConfigs: true,
          knowledgeBases: true,
          toolConfigs: true,
          businessHours: true,
          services: true,
        },
      });
    });
  }

  async updateProfile(
    data: Partial<{
      name: string;
      description: string;
      type: string;
      timezone: string;
      language: string;
      address: string | null;
      phone: string | null;
      whatsapp: string | null;
      email: string | null;
      website: string | null;
      instagram: string | null;
      additionalInfo: string | null;
      openingHours: object;
      defaultMessages: object;
      rules: object;
      dailyRequestLimit: number;
      dailyTokenLimit: number;
      allowedModels: string[];
    }>,
  ) {
    const current = await this.getCurrent();
    const email =
      data.email === '' ? null : (data.email as string | null | undefined);
    const website =
      data.website === '' ? null : (data.website as string | null | undefined);

    return this.prisma.business.update({
      where: { id: current.id },
      data: {
        ...data,
        email,
        website,
        defaultMessages: data.defaultMessages
          ? {
              ...DEFAULT_CONFIGURED_MESSAGES,
              ...(typeof current.defaultMessages === 'object' &&
              current.defaultMessages
                ? current.defaultMessages
                : {}),
              ...data.defaultMessages,
            }
          : undefined,
      },
      include: {
        agentConfigs: true,
        businessHours: { orderBy: { dayOfWeek: 'asc' } },
        services: true,
      },
    });
  }

  /** @deprecated use updateProfile for single-business */
  async update(
    id: string,
    data: Parameters<BusinessesService['updateProfile']>[0],
  ) {
    await this.get(id);
    return this.prisma.business.update({ where: { id }, data });
  }

  async updateAssistant(
    data: Partial<{
      name: string;
      tone: string;
      customInstructions: string | null;
      systemPrompt: string;
      personality: string | null;
      model: string;
      temperature: number;
      maxSteps: number;
      enabledTools: string[];
    }>,
  ) {
    const current = await this.getCurrent();
    const agent = current.agentConfigs[0];
    if (!agent) {
      throw new NotFoundException('No hay asistente configurado');
    }
    return this.prisma.agentConfig.update({
      where: { id: agent.id },
      data,
    });
  }

  async getHours(businessId?: string) {
    const id = businessId ?? (await this.getCurrentId());
    const hours = await this.prisma.businessHour.findMany({
      where: { businessId: id },
      orderBy: { dayOfWeek: 'asc' },
    });
    if (hours.length) return hours;

    // Fallback legacy JSON
    const business = await this.prisma.business.findUnique({
      where: { id },
      select: { openingHours: true, timezone: true },
    });
    return {
      timezone: business?.timezone,
      legacy: business?.openingHours,
      hours: [],
      labels: WEEKDAY_LABELS,
    };
  }

  async replaceHours(
    hours: Array<{
      dayOfWeek: number;
      isClosed: boolean;
      ranges: Array<{ start: string; end: string }>;
    }>,
  ) {
    const businessId = await this.getCurrentId();
    const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));

    return this.prisma.$transaction(async (tx) => {
      for (let day = 0; day <= 6; day += 1) {
        const entry = byDay.get(day) ?? {
          dayOfWeek: day,
          isClosed: true,
          ranges: [],
        };
        const ranges =
          entry.isClosed || !entry.ranges?.length ? [] : entry.ranges;

        await tx.businessHour.upsert({
          where: {
            businessId_dayOfWeek: { businessId, dayOfWeek: day },
          },
          create: {
            businessId,
            dayOfWeek: day,
            isClosed: entry.isClosed || ranges.length === 0,
            ranges,
          },
          update: {
            isClosed: entry.isClosed || ranges.length === 0,
            ranges,
          },
        });
      }

      // Mantener openingHours legacy sincronizado para tools antiguas
      const synced = await tx.businessHour.findMany({
        where: { businessId },
        orderBy: { dayOfWeek: 'asc' },
      });
      const legacyKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const legacy = Object.fromEntries(
        synced.map((row) => {
          const key = legacyKeys[row.dayOfWeek];
          if (row.isClosed || !Array.isArray(row.ranges) || !row.ranges.length) {
            return [key, null];
          }
          const first = row.ranges[0] as { start?: string; end?: string };
          return [key, { open: first.start, close: first.end, ranges: row.ranges }];
        }),
      );
      await tx.business.update({
        where: { id: businessId },
        data: { openingHours: legacy },
      });

      return synced;
    });
  }

  formatHoursForPrompt(
    hours: Array<{
      dayOfWeek: number;
      isClosed: boolean;
      ranges: unknown;
    }>,
  ): string {
    return hours
      .map((row) => {
        const label = WEEKDAY_LABELS[row.dayOfWeek] ?? `Día ${row.dayOfWeek}`;
        if (row.isClosed) return `${label}: Cerrado`;
        const ranges = Array.isArray(row.ranges)
          ? (row.ranges as Array<{ start: string; end: string }>)
          : [];
        if (!ranges.length) return `${label}: Cerrado`;
        return `${label}: ${ranges.map((r) => `${r.start}–${r.end}`).join(', ')}`;
      })
      .join('\n');
  }

  private async seedDefaultHours(
    tx: Prisma.TransactionClient,
    businessId: string,
  ) {
    const defaults = defaultWeeklyHours();
    await tx.businessHour.createMany({
      data: defaults.map((day) => ({
        businessId,
        dayOfWeek: day.dayOfWeek,
        isClosed: day.isClosed,
        ranges: day.ranges,
      })),
    });
    const legacyKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const legacy = Object.fromEntries(
      defaults.map((day) => {
        const key = legacyKeys[day.dayOfWeek];
        if (day.isClosed || !day.ranges.length) return [key, null];
        return [
          key,
          {
            open: day.ranges[0].start,
            close: day.ranges[day.ranges.length - 1].end,
            ranges: day.ranges,
          },
        ];
      }),
    );
    await tx.business.update({
      where: { id: businessId },
      data: { openingHours: legacy },
    });
  }

  private toolRisk(name: string): string {
    if (name === 'sendEmail') return 'SENSITIVE';
    if (
      name === 'createLead' ||
      name === 'requestHumanAssistance' ||
      name === 'triggerAutomation' ||
      name === 'createAppointment' ||
      name === 'cancelAppointment' ||
      name === 'rescheduleAppointment'
    ) {
      return 'WRITE';
    }
    return 'READ';
  }
}
