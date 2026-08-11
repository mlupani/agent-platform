import { Injectable } from '@nestjs/common';
import type {
  ConnectionStatus,
  MessagingProvider,
  SendMessageResult,
  SendTextInput,
} from '../../messaging/messaging-provider.interface';
import { WahaWhatsAppProvider } from './waha.whatsapp-provider';

/**
 * Adapter MessagingProvider sobre WAHA.
 * El Agent Core / inbox usan el canal de la conversación, no WAHA directo.
 */
@Injectable()
export class WahaMessagingProvider implements MessagingProvider {
  readonly channel = 'WHATSAPP' as const;

  constructor(private readonly waha: WahaWhatsAppProvider) {}

  async sendText(input: SendTextInput): Promise<SendMessageResult> {
    return this.waha.sendText({
      businessId: input.businessId,
      to: input.to,
      body: input.body,
    });
  }

  async getConnectionStatus(businessId?: string): Promise<ConnectionStatus> {
    if (!businessId) {
      return { status: 'disconnected' };
    }
    const status = await this.waha.getStatus(businessId);
    return {
      status: status.status,
      lastError: status.lastError,
      userId: status.meId,
      username: status.displayPhoneNumber,
    };
  }
}
