import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';
import { BusinessesService } from '../businesses/businesses.service';
import type { WhatsAppPublicConfig } from './whatsapp.types';

@Injectable()
export class WhatsAppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly businesses: BusinessesService,
    private readonly env: ConfigService,
  ) {}

  async getPublic(): Promise<WhatsAppPublicConfig | null> {
    const config = await this.ensureFromEnv();
    return this.toPublic(config);
  }

  /** Crea/actualiza defaults desde WAHA_* del entorno (sin pedir API key en el admin). */
  async ensureFromEnv() {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.whatsAppConfig.findUnique({
      where: { businessId },
    });

    const wahaBaseUrl =
      this.env.get<string>('WAHA_BASE_URL') ??
      existing?.wahaBaseUrl ??
      'http://localhost:3002';
    const sessionName = existing?.sessionName || 'default';

    if (!existing) {
      return this.prisma.whatsAppConfig.create({
        data: {
          businessId,
          provider: 'waha',
          wahaBaseUrl,
          sessionName,
          enabled: true,
          status: 'disconnected',
          lastError: null,
        },
      });
    }

    // Mantener URL alineada al entorno Docker/local si cambió
    if (
      this.env.get<string>('WAHA_BASE_URL') &&
      existing.wahaBaseUrl !== wahaBaseUrl
    ) {
      return this.prisma.whatsAppConfig.update({
        where: { businessId },
        data: {
          provider: 'waha',
          wahaBaseUrl,
          enabled: true,
        },
      });
    }

    if (!existing.enabled || existing.provider !== 'waha') {
      return this.prisma.whatsAppConfig.update({
        where: { businessId },
        data: { provider: 'waha', enabled: true },
      });
    }

    return existing;
  }

  async getForRuntime(businessId?: string) {
    const id = businessId ?? (await this.businesses.getCurrentId());
    return this.prisma.whatsAppConfig.findUnique({ where: { businessId: id } });
  }

  async getWahaApiKey(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    if (!config?.wahaApiKeyEnc) {
      return this.env.get<string>('WAHA_API_KEY') ?? null;
    }
    return this.secrets.decrypt(config.wahaApiKeyEnc);
  }

  async getAccessToken(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    if (!config?.accessTokenEnc) return null;
    return this.secrets.decrypt(config.accessTokenEnc);
  }

  resolveWebhookUrl(): string {
    const base =
      this.env.get<string>('API_URL') ??
      this.env.get<string>('NEXT_PUBLIC_API_URL')?.replace(/\/api\/?$/, '') ??
      'http://localhost:3001';
    return `${base.replace(/\/$/, '')}/api/webhooks/waha`;
  }

  async upsert(input: {
    provider?: string;
    wahaBaseUrl?: string | null;
    wahaApiKey?: string;
    sessionName?: string;
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
    displayPhoneNumber?: string | null;
    verifyToken?: string | null;
    accessToken?: string;
    enabled?: boolean;
  }): Promise<WhatsAppPublicConfig> {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.whatsAppConfig.findUnique({
      where: { businessId },
    });

    const provider = input.provider ?? existing?.provider ?? 'waha';
    const wahaApiKeyEnc = input.wahaApiKey
      ? this.secrets.encrypt(input.wahaApiKey)
      : existing?.wahaApiKeyEnc;
    const accessTokenEnc = input.accessToken
      ? this.secrets.encrypt(input.accessToken)
      : existing?.accessTokenEnc;

    const enabled = input.enabled ?? existing?.enabled ?? false;
    const wahaBaseUrl =
      input.wahaBaseUrl ??
      existing?.wahaBaseUrl ??
      this.env.get<string>('WAHA_BASE_URL') ??
      'http://localhost:3002';

    const config = await this.prisma.whatsAppConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        provider,
        wahaBaseUrl,
        wahaApiKeyEnc,
        sessionName: input.sessionName ?? 'default',
        phoneNumberId: input.phoneNumberId ?? null,
        businessAccountId: input.businessAccountId ?? null,
        displayPhoneNumber: input.displayPhoneNumber ?? null,
        verifyToken: input.verifyToken ?? null,
        accessTokenEnc,
        enabled,
        status: enabled ? 'disconnected' : 'disconnected',
        lastError: null,
      },
      update: {
        provider,
        wahaBaseUrl,
        ...(input.wahaApiKey ? { wahaApiKeyEnc } : {}),
        sessionName: input.sessionName ?? existing?.sessionName ?? 'default',
        phoneNumberId: input.phoneNumberId ?? existing?.phoneNumberId,
        businessAccountId:
          input.businessAccountId ?? existing?.businessAccountId,
        displayPhoneNumber:
          input.displayPhoneNumber ?? existing?.displayPhoneNumber,
        verifyToken: input.verifyToken ?? existing?.verifyToken,
        ...(input.accessToken ? { accessTokenEnc } : {}),
        enabled,
        lastError: null,
      },
    });

    return this.toPublic(config);
  }

  async setStatus(
    businessId: string,
    status: string,
    lastError?: string | null,
    extras?: {
      sessionStatus?: string | null;
      meId?: string | null;
      displayPhoneNumber?: string | null;
    },
  ) {
    await this.prisma.whatsAppConfig.updateMany({
      where: { businessId },
      data: {
        status,
        lastError: lastError ?? null,
        ...(extras?.sessionStatus !== undefined
          ? { sessionStatus: extras.sessionStatus }
          : {}),
        ...(extras?.meId !== undefined ? { meId: extras.meId } : {}),
        ...(extras?.displayPhoneNumber !== undefined
          ? { displayPhoneNumber: extras.displayPhoneNumber }
          : {}),
      },
    });
  }

  async findBySessionName(sessionName: string) {
    return this.prisma.whatsAppConfig.findFirst({
      where: { sessionName, enabled: true },
    });
  }

  async findByPhoneNumberId(phoneNumberId: string) {
    return this.prisma.whatsAppConfig.findFirst({
      where: { phoneNumberId, enabled: true },
    });
  }

  async requirePublic() {
    const config = await this.getPublic();
    if (!config) throw new NotFoundException('WhatsApp no está configurado');
    return config;
  }

  private toPublic(config: {
    id: string;
    businessId: string;
    provider: string;
    wahaBaseUrl: string | null;
    wahaApiKeyEnc: string | null;
    sessionName: string;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    displayPhoneNumber: string | null;
    meId: string | null;
    verifyToken: string | null;
    accessTokenEnc: string | null;
    enabled: boolean;
    status: string;
    sessionStatus: string | null;
    lastError: string | null;
  }): WhatsAppPublicConfig {
    return {
      id: config.id,
      businessId: config.businessId,
      provider: config.provider,
      wahaBaseUrl: config.wahaBaseUrl,
      sessionName: config.sessionName,
      hasWahaApiKey: Boolean(
        config.wahaApiKeyEnc || this.env.get<string>('WAHA_API_KEY'),
      ),
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      displayPhoneNumber: config.displayPhoneNumber,
      meId: config.meId,
      verifyTokenConfigured: Boolean(config.verifyToken),
      hasAccessToken: Boolean(config.accessTokenEnc),
      enabled: config.enabled,
      status: config.status,
      sessionStatus: config.sessionStatus,
      lastError: config.lastError,
      accessTokenPreview: config.accessTokenEnc ? '••••••••' : null,
      webhookUrl: this.resolveWebhookUrl(),
    };
  }
}
