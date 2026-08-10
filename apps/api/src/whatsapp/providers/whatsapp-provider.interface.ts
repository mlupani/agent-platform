export interface WhatsAppSendTextParams {
  businessId: string;
  to: string;
  body: string;
  session?: string;
}

export interface WhatsAppSendTextResult {
  externalId?: string;
}

export interface WhatsAppProviderStatus {
  status: string;
  sessionStatus?: string | null;
  meId?: string | null;
  displayPhoneNumber?: string | null;
  lastError?: string | null;
  qrDataUrl?: string | null;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(params: WhatsAppSendTextParams): Promise<WhatsAppSendTextResult>;
  getStatus(businessId: string): Promise<WhatsAppProviderStatus>;
  disconnect(businessId: string, options?: { logout?: boolean }): Promise<void>;
}
