import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withExponentialBackoff } from '../../common/utils/retry';
import { withTimeout } from '../../common/utils/timeout';
import { WhatsAppConfigService } from '../whatsapp-config.service';
import type {
  WhatsAppProvider,
  WhatsAppProviderStatus,
  WhatsAppSendTextParams,
  WhatsAppSendTextResult,
} from './whatsapp-provider.interface';

/**
 * Provider opcional para Meta Cloud API (futuro).
 * No es el default; se mantiene para no acoplar la app solo a WAHA.
 */
@Injectable()
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud';
  private readonly logger = new Logger(MetaCloudWhatsAppProvider.name);
  private readonly apiVersion: string;

  constructor(
    private readonly config: WhatsAppConfigService,
    private readonly env: ConfigService,
  ) {
    this.apiVersion = this.env.get('WHATSAPP_API_VERSION', 'v23.0');
  }

  async sendText(
    params: WhatsAppSendTextParams,
  ): Promise<WhatsAppSendTextResult> {
    const waConfig = await this.config.getForRuntime(params.businessId);
    if (
      !waConfig?.enabled ||
      !waConfig.accessTokenEnc ||
      !waConfig.phoneNumberId
    ) {
      throw new Error('Meta Cloud WhatsApp no está conectado');
    }
    const token = await this.config.getAccessToken(params.businessId);
    if (!token) throw new Error('Access token de Meta no disponible');

    const to = params.to.replace(/\D/g, '');
    const url = `https://graph.facebook.com/${this.apiVersion}/${waConfig.phoneNumberId}/messages`;

    try {
      const response = await withExponentialBackoff(() =>
        withTimeout(
          async () => {
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'text',
                text: { preview_url: false, body: params.body },
              }),
            });
            const json = (await res.json()) as {
              messages?: Array<{ id: string }>;
              error?: { message?: string };
            };
            if (!res.ok) {
              throw new Error(json.error?.message ?? `Meta API ${res.status}`);
            }
            return json;
          },
          12_000,
          'meta sendText',
        ),
      );
      await this.config.setStatus(params.businessId, 'connected', null);
      return { externalId: response.messages?.[0]?.id };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Meta send failed';
      this.logger.warn(message);
      await this.config.setStatus(params.businessId, 'error', message);
      throw error;
    }
  }

  async getStatus(businessId: string): Promise<WhatsAppProviderStatus> {
    const config = await this.config.getForRuntime(businessId);
    return {
      status: config?.status ?? 'disconnected',
      displayPhoneNumber: config?.displayPhoneNumber,
      lastError: config?.lastError,
    };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.config.setStatus(businessId, 'disconnected', null);
  }
}
