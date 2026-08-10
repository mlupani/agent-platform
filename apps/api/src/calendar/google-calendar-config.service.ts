import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';
import { BusinessesService } from '../businesses/businesses.service';
import type { GoogleCalendarPublicConfig } from './calendar.types';

@Injectable()
export class GoogleCalendarConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly businesses: BusinessesService,
    private readonly env: ConfigService,
  ) {}

  oauthConfigured(): boolean {
    return Boolean(
      this.env.get<string>('GOOGLE_CLIENT_ID') &&
        this.env.get<string>('GOOGLE_CLIENT_SECRET'),
    );
  }

  getOAuthCredentials() {
    const clientId = this.env.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.env.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri =
      this.env.get<string>('GOOGLE_REDIRECT_URI') ??
      `${this.env.get('API_URL', 'http://localhost:3001')}/api/oauth/google/callback`;
    if (!clientId || !clientSecret) {
      throw new Error(
        'Configurá GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el entorno',
      );
    }
    return { clientId, clientSecret, redirectUri };
  }

  async getPublic(): Promise<GoogleCalendarPublicConfig | null> {
    const businessId = await this.businesses.getCurrentId();
    const config = await this.prisma.googleCalendarConfig.findUnique({
      where: { businessId },
    });
    if (!config) return null;
    return this.toPublic(config);
  }

  async getForRuntime(businessId?: string) {
    const id = businessId ?? (await this.businesses.getCurrentId());
    return this.prisma.googleCalendarConfig.findUnique({
      where: { businessId: id },
    });
  }

  async getRefreshToken(businessId: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    if (!config?.refreshTokenEnc) return null;
    return this.secrets.decrypt(config.refreshTokenEnc);
  }

  async upsert(input: {
    calendarId?: string;
    refreshToken?: string;
    enabled?: boolean;
    connectedEmail?: string | null;
  }): Promise<GoogleCalendarPublicConfig> {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.googleCalendarConfig.findUnique({
      where: { businessId },
    });

    const refreshTokenEnc = input.refreshToken
      ? this.secrets.encrypt(input.refreshToken)
      : existing?.refreshTokenEnc;
    const enabled = input.enabled ?? existing?.enabled ?? false;
    const hasToken = Boolean(refreshTokenEnc);

    const config = await this.prisma.googleCalendarConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        calendarId: input.calendarId ?? 'primary',
        refreshTokenEnc,
        enabled,
        connectedEmail: input.connectedEmail ?? null,
        status: enabled && hasToken ? 'connected' : 'disconnected',
        lastError: null,
      },
      update: {
        calendarId: input.calendarId ?? existing?.calendarId ?? 'primary',
        ...(input.refreshToken ? { refreshTokenEnc } : {}),
        enabled,
        ...(input.connectedEmail !== undefined
          ? { connectedEmail: input.connectedEmail }
          : {}),
        status: enabled && hasToken ? 'connected' : 'disconnected',
        lastError: null,
      },
    });

    return this.toPublic(config);
  }

  async saveTokens(params: {
    businessId: string;
    refreshToken?: string;
    connectedEmail?: string | null;
  }) {
    const existing = await this.prisma.googleCalendarConfig.findUnique({
      where: { businessId: params.businessId },
    });
    const refreshTokenEnc = params.refreshToken
      ? this.secrets.encrypt(params.refreshToken)
      : existing?.refreshTokenEnc;

    return this.prisma.googleCalendarConfig.upsert({
      where: { businessId: params.businessId },
      create: {
        businessId: params.businessId,
        calendarId: 'primary',
        refreshTokenEnc,
        enabled: true,
        connectedEmail: params.connectedEmail ?? null,
        status: refreshTokenEnc ? 'connected' : 'disconnected',
      },
      update: {
        ...(params.refreshToken ? { refreshTokenEnc } : {}),
        enabled: true,
        connectedEmail: params.connectedEmail ?? existing?.connectedEmail,
        status: refreshTokenEnc ? 'connected' : 'disconnected',
        lastError: null,
      },
    });
  }

  async setStatus(
    businessId: string,
    status: string,
    lastError?: string | null,
  ) {
    await this.prisma.googleCalendarConfig.updateMany({
      where: { businessId },
      data: { status, lastError: lastError ?? null },
    });
  }

  async requirePublic() {
    const config = await this.getPublic();
    if (!config) throw new NotFoundException('Google Calendar no configurado');
    return config;
  }

  private toPublic(config: {
    id: string;
    businessId: string;
    calendarId: string;
    refreshTokenEnc: string | null;
    enabled: boolean;
    status: string;
    lastError: string | null;
    connectedEmail: string | null;
  }): GoogleCalendarPublicConfig {
    return {
      id: config.id,
      businessId: config.businessId,
      calendarId: config.calendarId,
      enabled: config.enabled,
      status: config.status,
      lastError: config.lastError,
      connectedEmail: config.connectedEmail,
      hasRefreshToken: Boolean(config.refreshTokenEnc),
      oauthConfigured: this.oauthConfigured(),
    };
  }
}
