export interface NormalizedInboundMessage {
  businessId: string;
  conversationId?: string;
  userId?: string;
  externalId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  businessId: string;
  conversationId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly type: string;
  receive(payload: unknown): Promise<NormalizedInboundMessage>;
  send(message: OutboundMessage): Promise<void>;
}
