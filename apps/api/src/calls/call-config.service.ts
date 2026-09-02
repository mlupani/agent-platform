import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { VapiCallConfig } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';
import { BusinessesService } from '../businesses/businesses.service';
import { VapiClient } from './vapi.client';
import type {
  UpsertVapiCallInput,
  VapiCallPublicConfig,
  VapiPhoneNumber,
} from './calls.types';

/**
 * Config 1:1 por negocio para llamadas de voz con Vapi.
 * Mismo patrón que WhatsAppConfigService: cifra la API key, nunca la expone
 * en la config pública y mantiene el webhookSecret una sola vez.
 */
@Injectable()
export class CallConfigService {
  private readonly logger = new Logger(CallConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly businesses: BusinessesService,
    private readonly env: ConfigService,
    private readonly vapi: VapiClient,
  ) {}

  /** URL pública del webhook de Vapi, alineada al entorno. */
  resolveWebhookUrl(): string {
    const base =
      this.env.get<string>('API_URL') ??
      this.env.get<string>('NEXT_PUBLIC_API_URL')?.replace(/\/api\/?$/, '') ??
      'http://localhost:3001';
    return `${base.replace(/\/$/, '')}/api/webhooks/vapi`;
  }

  /** Config cruda de Prisma para uso interno (workers, webhooks). */
  async getForRuntime(businessId?: string): Promise<VapiCallConfig | null> {
    const id = businessId ?? (await this.businesses.getCurrentId());
    return this.prisma.vapiCallConfig.findUnique({ where: { businessId: id } });
  }

  /** API key: primero la guardada (descifrada), si no cae a VAPI_API_KEY del entorno. */
  async getApiKey(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    if (config?.vapiApiKeyEnc) return this.secrets.decrypt(config.vapiApiKeyEnc);
    return this.env.get<string>('VAPI_API_KEY') ?? null;
  }

  /** Secreto compartido para validar la firma de los webhooks de Vapi. */
  async getWebhookSecret(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    return config?.webhookSecret ?? null;
  }

  /** Config pública para el admin: sin secretos. */
  async getPublic(): Promise<VapiCallPublicConfig | null> {
    const businessId = await this.businesses.getCurrentId();
    const config = await this.prisma.vapiCallConfig.findUnique({
      where: { businessId },
    });
    if (!config) return null;
    return this.toPublic(config);
  }

  /** Lista los números de teléfono disponibles en la cuenta de Vapi. */
  async listPhoneNumbers(): Promise<VapiPhoneNumber[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Falta la API key de Vapi');
    return this.vapi.listPhoneNumbers(apiKey);
  }

  /** Marca el estado de la config (usado por webhooks y sync). */
  async setStatus(
    businessId: string,
    status: string,
    lastError?: string | null,
  ): Promise<void> {
    await this.prisma.vapiCallConfig.updateMany({
      where: { businessId },
      data: { status, lastError: lastError ?? null },
    });
  }

  /** Crea/actualiza la config y, si hay número + API key, apunta el server.url en Vapi. */
  async upsert(input: UpsertVapiCallInput): Promise<VapiCallPublicConfig> {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.vapiCallConfig.findUnique({
      where: { businessId },
    });

    const vapiApiKeyEnc = input.vapiApiKey
      ? this.secrets.encrypt(input.vapiApiKey)
      : existing?.vapiApiKeyEnc ?? null;
    const webhookSecret =
      existing?.webhookSecret ?? randomBytes(24).toString('hex');
    const phoneNumberId =
      input.phoneNumberId === undefined
        ? existing?.phoneNumberId ?? null
        : input.phoneNumberId;

    const data = {
      vapiApiKeyEnc,
      webhookSecret,
      phoneNumberId,
      voiceProvider: input.voiceProvider ?? existing?.voiceProvider ?? 'vapi',
      voiceId: input.voiceId ?? existing?.voiceId ?? 'Elliot',
      transcriberLanguage:
        input.transcriberLanguage === undefined
          ? existing?.transcriberLanguage ?? null
          : input.transcriberLanguage || null,
      firstMessage:
        input.firstMessage === undefined
          ? existing?.firstMessage ?? null
          : input.firstMessage || null,
      enabled: input.enabled ?? existing?.enabled ?? false,
      agentEnabled: input.agentEnabled ?? existing?.agentEnabled ?? true,
    };

    let config = await this.prisma.vapiCallConfig.upsert({
      where: { businessId },
      create: { businessId, status: 'disconnected', ...data },
      update: { ...data },
    });

    if (phoneNumberId && vapiApiKeyEnc) {
      config = await this.applyServerUrl(businessId, config);
    }

    return this.toPublic(config);
  }

  /** Re-aplica el server.url al número actualmente configurado. */
  async syncPhoneNumber(): Promise<VapiCallPublicConfig> {
    const businessId = await this.businesses.getCurrentId();
    const config = await this.prisma.vapiCallConfig.findUnique({
      where: { businessId },
    });
    if (!config?.phoneNumberId) throw new Error('No hay número configurado');
    const updated = await this.applyServerUrl(businessId, config);
    return this.toPublic(updated);
  }

  /**
   * Apunta el número de Vapi a nuestro webhook y limpia assistant/squad.
   * Si Vapi falla NO lanza: deja status 'error' + lastError para que el
   * guardado de la config siga siendo exitoso.
   */
  private async applyServerUrl(
    businessId: string,
    config: VapiCallConfig,
  ): Promise<VapiCallConfig> {
    try {
      const apiKey = await this.getApiKey(businessId);
      if (!apiKey) throw new Error('Falta la API key de Vapi');
      const remote = await this.vapi.getPhoneNumber(
        apiKey,
        config.phoneNumberId!,
      );
      // El body del PATCH es una unión discriminada por `provider` (twilio,
      // vonage, telnyx, byo-phone-number, vapi...). Sin el discriminador Vapi no
      // sabe qué DTO validar. Mandamos sólo ese campo del GET previo: el resto
      // del objeto remoto trae campos de sólo lectura (id, orgId, createdAt).
      await this.vapi.updatePhoneNumber(apiKey, config.phoneNumberId!, {
        ...(typeof remote.provider === 'string'
          ? { provider: remote.provider }
          : {}),
        assistantId: null,
        squadId: null,
        server: { url: this.resolveWebhookUrl(), secret: config.webhookSecret },
      });
      const phoneNumberE164 =
        typeof remote.number === 'string'
          ? remote.number
          : config.phoneNumberE164;
      const lastSyncedAt = new Date();
      await this.prisma.vapiCallConfig.updateMany({
        where: { businessId },
        data: {
          status: 'connected',
          lastError: null,
          lastSyncedAt,
          phoneNumberE164,
        },
      });
      return {
        ...config,
        status: 'connected',
        lastError: null,
        lastSyncedAt,
        phoneNumberE164,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error apuntando el número en Vapi';
      this.logger.warn(`applyServerUrl falló: ${message}`);
      await this.setStatus(businessId, 'error', message);
      return { ...config, status: 'error', lastError: message };
    }
  }

  private toPublic(config: VapiCallConfig): VapiCallPublicConfig {
    return {
      businessId: config.businessId,
      hasApiKey: Boolean(
        config.vapiApiKeyEnc || this.env.get<string>('VAPI_API_KEY'),
      ),
      phoneNumberId: config.phoneNumberId,
      phoneNumberE164: config.phoneNumberE164,
      voiceProvider: config.voiceProvider,
      voiceId: config.voiceId,
      transcriberLanguage: config.transcriberLanguage,
      firstMessage: config.firstMessage,
      enabled: config.enabled,
      agentEnabled: config.agentEnabled,
      status: config.status,
      lastError: config.lastError,
      lastSyncedAt: config.lastSyncedAt
        ? config.lastSyncedAt.toISOString()
        : null,
      webhookUrl: this.resolveWebhookUrl(),
    };
  }
}
