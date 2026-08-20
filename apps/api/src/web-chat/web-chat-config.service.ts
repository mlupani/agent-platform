import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import type { WebChatPublicConfig } from './web-chat.types';
import {
  generateWidgetApiKey,
  hashWidgetApiKey,
  widgetApiKeyPrefix,
} from './web-chat-api-key.util';

@Injectable()
export class WebChatConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly env: ConfigService,
  ) {}

  async ensureConfig() {
    const businessId = await this.businesses.getCurrentId();
    return this.ensureForBusiness(businessId);
  }

  async getPublic(): Promise<WebChatPublicConfig> {
    const config = await this.ensureConfig();
    return this.toPublic(config);
  }

  async getForRuntime(businessId?: string) {
    const id = businessId ?? (await this.businesses.getCurrentId());
    return this.prisma.webChatConfig.findUnique({ where: { businessId: id } });
  }

  async findByApiKeyHash(apiKeyHash: string) {
    return this.prisma.webChatConfig.findFirst({
      where: { apiKeyHash, enabled: true },
    });
  }

  async upsertSettings(input: {
    enabled?: boolean;
    allowedOrigins?: string[];
  }): Promise<WebChatPublicConfig> {
    const existing = await this.ensureConfig();
    const enabled = input.enabled ?? existing.enabled;
    const hasKey = Boolean(existing.apiKeyHash);
    const config = await this.prisma.webChatConfig.update({
      where: { businessId: existing.businessId },
      data: {
        ...(input.allowedOrigins !== undefined
          ? { allowedOrigins: input.allowedOrigins }
          : {}),
        enabled: enabled && hasKey,
        status: enabled && hasKey ? 'connected' : 'disconnected',
        lastError:
          enabled && !hasKey
            ? 'Generá una API key para activar el canal.'
            : null,
      },
    });
    return this.toPublic(config);
  }

  async generateApiKey(): Promise<{
    apiKey: string;
    config: WebChatPublicConfig;
  }> {
    const existing = await this.ensureConfig();
    const apiKey = generateWidgetApiKey();
    const config = await this.prisma.webChatConfig.update({
      where: { businessId: existing.businessId },
      data: {
        apiKeyHash: hashWidgetApiKey(apiKey),
        apiKeyPrefix: widgetApiKeyPrefix(apiKey),
        enabled: true,
        status: 'connected',
        lastError: null,
      },
    });
    return { apiKey, config: this.toPublic(config) };
  }

  async touchLastUsed(businessId: string) {
    await this.prisma.webChatConfig.updateMany({
      where: { businessId },
      data: { lastUsedAt: new Date() },
    });
  }

  resolveWidgetUrl(): string {
    return `${this.apiBase()}/api/widget/messages`;
  }

  resolveConversationsUrl(): string {
    return `${this.apiBase()}/api/widget/conversations`;
  }

  private apiBase(): string {
    const base =
      this.env.get<string>('API_URL') ??
      this.env.get<string>('NEXT_PUBLIC_API_URL')?.replace(/\/api\/?$/, '') ??
      'http://localhost:3001';
    return base.replace(/\/$/, '');
  }

  private async ensureForBusiness(businessId: string) {
    const existing = await this.prisma.webChatConfig.findUnique({
      where: { businessId },
    });
    if (existing) return existing;
    return this.prisma.webChatConfig.create({
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
    apiKeyHash: string | null;
    apiKeyPrefix: string | null;
    allowedOrigins: string[];
    lastError: string | null;
    lastUsedAt: Date | null;
  }): WebChatPublicConfig {
    return {
      id: config.id,
      businessId: config.businessId,
      enabled: config.enabled,
      status: config.status,
      hasApiKey: Boolean(config.apiKeyHash),
      apiKeyPrefix: config.apiKeyPrefix,
      allowedOrigins: config.allowedOrigins,
      lastError: config.lastError,
      lastUsedAt: config.lastUsedAt?.toISOString() ?? null,
      widgetUrl: this.resolveWidgetUrl(),
      conversationsUrl: this.resolveConversationsUrl(),
    };
  }
}
