export interface VapiPhoneNumber {
  id: string;
  number: string | null;
  name: string | null;
  provider: string;
}

/** Config pública de llamadas: nunca incluye secretos (API key ni webhookSecret). */
export interface VapiCallPublicConfig {
  businessId: string;
  hasApiKey: boolean;
  phoneNumberId: string | null;
  phoneNumberE164: string | null;
  voiceProvider: string;
  voiceId: string;
  transcriberLanguage: string | null;
  firstMessage: string | null;
  enabled: boolean;
  agentEnabled: boolean;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  webhookUrl: string;
}

/** Datos que llegan del admin para crear/actualizar la config de llamadas. */
export interface UpsertVapiCallInput {
  vapiApiKey?: string;
  phoneNumberId?: string | null;
  voiceProvider?: string;
  voiceId?: string;
  transcriberLanguage?: string | null;
  firstMessage?: string | null;
  enabled?: boolean;
  agentEnabled?: boolean;
}
