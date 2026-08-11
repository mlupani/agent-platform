import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';
import { BusinessesService } from '../businesses/businesses.service';
import type { InstagramPublicConfig } from './instagram.types';

@Injectable()
export class InstagramConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly businesses: BusinessesService,
    private readonly env: ConfigService,
  ) {}

  resolveApiUrl(): string {
    return (
      this.env.get<string>('INSTAGRAM_API_URL')?.replace(/\/$/, '') ||
      'http://localhost:8000'
    );
  }

  syncIntervalMs(): number {
    const raw = this.env.get<string>('INSTAGRAM_SYNC_INTERVAL_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 5_000) return parsed;
    return 15_000;
  }

  async ensureConfig() {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.instagramConfig.findUnique({
      where: { businessId },
    });
    if (existing) return existing;
    return this.prisma.instagramConfig.create({
      data: {
        businessId,
        enabled: false,
        status: 'disconnected',
      },
    });
  }

  async getPublic(): Promise<InstagramPublicConfig> {
    const config = await this.ensureConfig();
    return this.toPublic(config);
  }

  async getForRuntime(businessId?: string) {
    const id = businessId ?? (await this.businesses.getCurrentId());
    return this.prisma.instagramConfig.findUnique({ where: { businessId: id } });
  }

  async getSessionId(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    if (!config?.sessionIdEnc) return null;
    return this.secrets.decrypt(config.sessionIdEnc);
  }

  async listEnabledBusinessIds(): Promise<string[]> {
    const rows = await this.prisma.instagramConfig.findMany({
      where: {
        enabled: true,
        sessionIdEnc: { not: null },
        status: { in: ['connected', 'error', 'connecting'] },
      },
      select: { businessId: true },
    });
    return rows.map((row) => row.businessId);
  }

  /** @deprecated use listEnabledBusinessIds */
  async listConnectedBusinessIds(): Promise<string[]> {
    return this.listEnabledBusinessIds();
  }

  async setSession(input: {
    businessId: string;
    sessionId: string;
    username?: string | null;
    userId?: string | null;
    status?: string;
    lastError?: string | null;
  }) {
    await this.ensureForBusiness(input.businessId);
    return this.prisma.instagramConfig.update({
      where: { businessId: input.businessId },
      data: {
        sessionIdEnc: this.secrets.encrypt(input.sessionId),
        username: input.username ?? undefined,
        userId: input.userId ?? undefined,
        enabled: true,
        status: input.status ?? 'connected',
        lastError: input.lastError ?? null,
      },
    });
  }

  async clearSession(businessId: string, status = 'disconnected') {
    await this.ensureForBusiness(businessId);
    return this.prisma.instagramConfig.update({
      where: { businessId },
      data: {
        sessionIdEnc: null,
        username: null,
        userId: null,
        enabled: false,
        status,
        lastError: null,
      },
    });
  }

  async setStatus(
    businessId: string,
    status: string,
    lastError?: string | null,
    extra?: { lastSyncAt?: Date | null; username?: string | null; userId?: string | null },
  ) {
    await this.ensureForBusiness(businessId);
    return this.prisma.instagramConfig.update({
      where: { businessId },
      data: {
        status,
        lastError: lastError === undefined ? undefined : lastError,
        lastSyncAt: extra?.lastSyncAt === undefined ? undefined : extra.lastSyncAt,
        username: extra?.username === undefined ? undefined : extra.username,
        userId: extra?.userId === undefined ? undefined : extra.userId,
      },
    });
  }

  async markSynced(businessId: string, at = new Date()) {
    await this.ensureForBusiness(businessId);
    return this.prisma.instagramConfig.update({
      where: { businessId },
      data: { lastSyncAt: at },
    });
  }

  private async ensureForBusiness(businessId: string) {
    const existing = await this.prisma.instagramConfig.findUnique({
      where: { businessId },
    });
    if (existing) return existing;
    return this.prisma.instagramConfig.create({
      data: {
        businessId,
        enabled: false,
        status: 'disconnected',
      },
    });
  }

  toPublic(config: {
    id: string;
    businessId: string;
    enabled: boolean;
    status: string;
    username: string | null;
    userId: string | null;
    lastError: string | null;
    lastSyncAt: Date | null;
    sessionIdEnc: string | null;
  }): InstagramPublicConfig {
    return {
      id: config.id,
      businessId: config.businessId,
      enabled: config.enabled,
      status: config.status,
      username: config.username,
      userId: config.userId,
      lastError: config.lastError,
      lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
      hasSession: Boolean(config.sessionIdEnc),
      apiUrlConfigured: Boolean(this.env.get<string>('INSTAGRAM_API_URL')),
    };
  }
}
