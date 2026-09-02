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

/**
 * Evento de servidor que Vapi POSTea a nuestro webhook: `assistant-request`,
 * `status-update`, `end-of-call-report`, `hang`, etc. Sólo tipamos los campos
 * que consumimos; el resto llega pero se ignora.
 */
export interface VapiServerMessage {
  type: string;
  call?: {
    id?: string;
    /** El LLAMANTE. Puede faltar si el número viene oculto. */
    customer?: { number?: string };
    /** NUESTRO número de Vapi (el que discaron). Nunca es el del llamante. */
    phoneNumber?: { number?: string };
  };
  /** Vapi también manda el objeto del número al tope del mensaje. Es el nuestro. */
  phoneNumber?: { number?: string };
  status?: string;
  endedReason?: string;
  cost?: number;
  startedAt?: string;
  endedAt?: string;
  artifact?: { transcript?: string };
  analysis?: { summary?: string };
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
  /** NUESTRO número de Vapi (el que discaron). Nunca es el del llamante. */
  phoneNumber?: { number?: string };
  /** El LLAMANTE. Puede faltar si el número viene oculto. */
  customer?: { number?: string };
}
