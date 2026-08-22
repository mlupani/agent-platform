export const conversationStatuses = [
  'AI',
  'WAITING_HUMAN',
  'HUMAN',
  'CLOSED',
] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

/** Remitente visible en bandeja / UI */
export const messageSenders = [
  'CLIENT',
  'AI',
  'HUMAN',
  'TOOL',
  'SYSTEM',
] as const;
export type MessageSender = (typeof messageSenders)[number];

export const messageRoles = ['system', 'user', 'assistant', 'tool'] as const;
export type MessageRole = (typeof messageRoles)[number];

export const toolRisks = ['READ', 'WRITE', 'SENSITIVE'] as const;
export type ToolRisk = (typeof toolRisks)[number];

export const channelTypes = [
  'WEB',
  'PLAYGROUND',
  'WHATSAPP',
  'TELEGRAM',
  'INSTAGRAM',
] as const;
export type ChannelType = (typeof channelTypes)[number];

/** Canales de prueba del panel: solo visibles para rol ADMIN. WEB (widget) sí entra a la bandeja. */
export const ADMIN_ONLY_CONVERSATION_CHANNELS = ['PLAYGROUND'] as const;

/** Canales de mensajería con provider outbound */
export const messagingChannels = ['WHATSAPP', 'INSTAGRAM'] as const;
export type MessagingChannel = (typeof messagingChannels)[number];

export const memoryTypes = ['SHORT_TERM', 'LONG_TERM'] as const;
export type MemoryType = (typeof memoryTypes)[number];

export const businessTypes = [
  'HOTEL',
  'REAL_ESTATE',
  'LABORATORY',
  'CLINIC',
  'LAW_FIRM',
  'GYM',
  'RETAIL',
  'OTHER',
] as const;
export type BusinessType = (typeof businessTypes)[number];

export const llmProviders = [
  'openai',
  'anthropic',
  'gemini',
  'ollama',
] as const;
export type LlmProviderName = (typeof llmProviders)[number];

export const assistantTones = [
  'professional_warm',
  'formal',
  'friendly',
  'casual',
  'custom',
] as const;
export type AssistantTone = (typeof assistantTones)[number];

export const ASSISTANT_TONE_LABELS: Record<AssistantTone, string> = {
  professional_warm: 'Profesional y cálido',
  formal: 'Formal',
  friendly: 'Amigable',
  casual: 'Casual',
  custom: 'Personalizado',
};

/** 0 = lunes … 6 = domingo */
export const WEEKDAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export const DEFAULT_MEMORY_STRATEGY = {
  recentMessages: 12,
  includeSummary: true,
  semanticTopK: 3,
} as const;

export const DEFAULT_CONFIGURED_MESSAGES = {
  welcome: 'Hola, soy el asistente virtual. ¿En qué puedo ayudarte?',
  offline:
    'Ahora mismo estamos fuera de horario. Dejá tus datos y te contactamos.',
  handoff: 'Te derivo con una persona del equipo.',
  appointmentConfirmation:
    'Tu cita quedó confirmada. Si necesitás cambiarla, avisame.',
  appointmentCancellation: 'Tu cita fue cancelada.',
  error: 'Tuve un problema al procesar tu pedido. ¿Podés intentarlo de nuevo?',
  fallback:
    'No estoy seguro de esa consulta. ¿Querés que te derive con una persona?',
} as const;

export type ConfiguredMessageKey = keyof typeof DEFAULT_CONFIGURED_MESSAGES;

export const GENERIC_TOOLS = [
  'getBusinessInformation',
  'getOpeningHours',
  'getServices',
  'checkAvailability',
  'createAppointment',
  'cancelAppointment',
  'rescheduleAppointment',
  'createLead',
  'requestHumanAssistance',
  'sendEmail',
  'sendWhatsAppMessage',
  'triggerAutomation',
] as const;

export function defaultWeeklyHours(): Array<{
  dayOfWeek: number;
  isClosed: boolean;
  ranges: Array<{ start: string; end: string }>;
}> {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
    if (dayOfWeek === 6) {
      return { dayOfWeek, isClosed: true, ranges: [] };
    }
    if (dayOfWeek === 5) {
      return {
        dayOfWeek,
        isClosed: false,
        ranges: [{ start: '10:00', end: '14:00' }],
      };
    }
    return {
      dayOfWeek,
      isClosed: false,
      ranges: [
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ],
    };
  });
}
