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

/** Mensaje del payload OpenAI `/chat/completions` que manda Vapi (custom-llm). */
export interface VapiChatMessage {
  role: string;
  content?: string | null;
}

/**
 * Body OpenAI `/chat/completions` que Vapi POSTea por cada turno del usuario.
 * Incluye extras propios de Vapi (`call`, `metadata`, `phoneNumber`, `customer`).
 */
export interface VapiChatCompletionBody {
  model?: string;
  stream?: boolean;
  messages?: VapiChatMessage[];
  call?: { id?: string };
  metadata?: Record<string, unknown>;
  phoneNumber?: { number?: string };
  customer?: { number?: string };
}
