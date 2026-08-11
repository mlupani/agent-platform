import type { MessagingChannel } from '../common/constants';

export interface SendTextInput {
  businessId: string;
  /** thread id (Instagram) o chatId/phone (WhatsApp) */
  to: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface SendMessageResult {
  externalId?: string;
}

export interface ConnectionStatus {
  status: string;
  lastError?: string | null;
  username?: string | null;
  userId?: string | null;
  lastSyncAt?: string | null;
}

export interface MessagingProvider {
  readonly channel: MessagingChannel;
  sendText(input: SendTextInput): Promise<SendMessageResult>;
  getConnectionStatus(businessId?: string): Promise<ConnectionStatus>;
}
