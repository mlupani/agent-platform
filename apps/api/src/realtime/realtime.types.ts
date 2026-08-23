export const REALTIME_EVENTS = {
  CONVERSATION_MESSAGE_CREATED: 'conversation.message.created',
  CONVERSATION_UPDATED: 'conversation.updated',
  CONVERSATION_BOT_STATUS_CHANGED: 'conversation.bot_status.changed',
  CONVERSATION_INBOX_CLEARED: 'conversation.inbox.cleared',
  WHATSAPP_STATUS_CHANGED: 'whatsapp.status.changed',
  WHATSAPP_QR_UPDATED: 'whatsapp.qr.updated',
  INSTAGRAM_STATUS_CHANGED: 'instagram.status.changed',
  FACEBOOK_STATUS_CHANGED: 'facebook.status.changed',
  MESSAGE_STATUS_UPDATED: 'message.status.updated',
  CONTENT_GENERATION_STARTED: 'content.generation.started',
  CONTENT_GENERATION_COMPLETED: 'content.generation.completed',
  CONTENT_GENERATION_FAILED: 'content.generation.failed',
  CONTENT_PUBLISHING: 'content.publishing',
  CONTENT_PUBLISHED: 'content.published',
  CONTENT_UPDATED: 'content.updated',
} as const;

export type RealtimeEventName =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEventName | string;
  businessId?: string;
  payload: T;
  at: string;
}
