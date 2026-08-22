export interface WhatsAppPublicConfig {
  id: string;
  businessId: string;
  provider: string;
  wahaBaseUrl: string | null;
  sessionName: string;
  hasWahaApiKey: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhoneNumber: string | null;
  meId: string | null;
  verifyTokenConfigured: boolean;
  hasAccessToken: boolean;
  enabled: boolean;
  agentEnabled: boolean;
  status: string;
  sessionStatus: string | null;
  lastError: string | null;
  accessTokenPreview: string | null;
  webhookUrl: string;
  qrDataUrl?: string | null;
}

export interface WhatsAppInboundText {
  externalId: string;
  from: string;
  text: string;
  timestamp: string;
  contactName?: string;
  session?: string;
}

export interface WhatsAppStatusUpdate {
  externalId: string;
  status: string;
  timestamp?: string;
  errors?: unknown;
}
