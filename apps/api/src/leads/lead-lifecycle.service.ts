import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CONVERSION_MODES,
  DEFAULT_FOLLOW_UP_DELAYS_HOURS,
  SEND_MODES,
  type ConversionMode,
  type SendMode,
} from './lead.constants';

export interface LeadLifecyclePublicConfig {
  followUpEnabled: boolean;
  conversionMode: ConversionMode;
  conversionTriggers: string[];
  followUpDelaysHours: number[];
  maxAttempts: number;
  generateWithAi: boolean;
  sendMode: SendMode;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string | null;
  preferredChannel: string;
  askForMissingContact: boolean;
  convertedClientStatusSlug: string;
  trialClientStatusSlug: string;
}

const DEFAULTS: LeadLifecyclePublicConfig = {
  followUpEnabled: false,
  conversionMode: 'manual',
  conversionTriggers: [],
  followUpDelaysHours: DEFAULT_FOLLOW_UP_DELAYS_HOURS,
  maxAttempts: 3,
  generateWithAi: true,
  sendMode: 'reminder_only',
  quietHoursStart: '09:00',
  quietHoursEnd: '21:00',
  timezone: null,
  preferredChannel: 'auto',
  askForMissingContact: true,
  convertedClientStatusSlug: 'activo',
  trialClientStatusSlug: 'visita',
};

@Injectable()
export class LeadLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublic(businessId: string): Promise<LeadLifecyclePublicConfig> {
    const row = await this.prisma.leadLifecycleConfig.findUnique({
      where: { businessId },
    });
    return this.toPublic(row);
  }

  async upsert(
    businessId: string,
    input: Partial<LeadLifecyclePublicConfig>,
  ): Promise<LeadLifecyclePublicConfig> {
    const current = await this.getPublic(businessId);
    const data = {
      followUpEnabled: input.followUpEnabled ?? current.followUpEnabled,
      conversionMode: this.mode(input.conversionMode ?? current.conversionMode),
      conversionTriggers: input.conversionTriggers ?? current.conversionTriggers,
      followUpDelaysHours: this.delays(
        input.followUpDelaysHours ?? current.followUpDelaysHours,
      ),
      maxAttempts: this.clampAttempts(input.maxAttempts ?? current.maxAttempts),
      generateWithAi: input.generateWithAi ?? current.generateWithAi,
      sendMode: this.sendMode(input.sendMode ?? current.sendMode),
      quietHoursStart: input.quietHoursStart ?? current.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd ?? current.quietHoursEnd,
      timezone: input.timezone === undefined ? current.timezone : input.timezone,
      preferredChannel: input.preferredChannel ?? current.preferredChannel,
      askForMissingContact:
        input.askForMissingContact ?? current.askForMissingContact,
      convertedClientStatusSlug:
        input.convertedClientStatusSlug ?? current.convertedClientStatusSlug,
      trialClientStatusSlug:
        input.trialClientStatusSlug ?? current.trialClientStatusSlug,
    };

    await this.prisma.leadLifecycleConfig.upsert({
      where: { businessId },
      create: { businessId, ...data },
      update: data,
    });
    return this.getPublic(businessId);
  }

  private toPublic(
    row: {
      followUpEnabled: boolean;
      conversionMode: string;
      conversionTriggers: string[];
      followUpDelaysHours: number[];
      maxAttempts: number;
      generateWithAi: boolean;
      sendMode: string;
      quietHoursStart: string;
      quietHoursEnd: string;
      timezone: string | null;
      preferredChannel: string;
      askForMissingContact: boolean;
      convertedClientStatusSlug: string;
      trialClientStatusSlug: string;
    } | null,
  ): LeadLifecyclePublicConfig {
    if (!row) return DEFAULTS;
    return {
      followUpEnabled: row.followUpEnabled,
      conversionMode: this.mode(row.conversionMode),
      conversionTriggers: row.conversionTriggers,
      followUpDelaysHours: this.delays(row.followUpDelaysHours),
      maxAttempts: this.clampAttempts(row.maxAttempts),
      generateWithAi: row.generateWithAi,
      sendMode: this.sendMode(row.sendMode),
      quietHoursStart: row.quietHoursStart || DEFAULTS.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd || DEFAULTS.quietHoursEnd,
      timezone: row.timezone,
      preferredChannel: row.preferredChannel || 'auto',
      askForMissingContact: row.askForMissingContact,
      convertedClientStatusSlug: row.convertedClientStatusSlug || 'activo',
      trialClientStatusSlug: row.trialClientStatusSlug || 'visita',
    };
  }

  private mode(value: string): ConversionMode {
    return (CONVERSION_MODES as readonly string[]).includes(value)
      ? (value as ConversionMode)
      : 'manual';
  }

  private sendMode(value: string): SendMode {
    return (SEND_MODES as readonly string[]).includes(value)
      ? (value as SendMode)
      : 'reminder_only';
  }

  private delays(values: number[]) {
    const next = values
      .map((item) => Math.round(item))
      .filter((item) => item >= 1 && item <= 24 * 30)
      .slice(0, 6);
    return next.length ? next : DEFAULT_FOLLOW_UP_DELAYS_HOURS;
  }

  private clampAttempts(value: number) {
    return Math.min(8, Math.max(1, Math.round(value)));
  }
}
