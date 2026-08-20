export interface WebChatPublicConfig {
  id: string;
  businessId: string;
  enabled: boolean;
  status: string;
  hasApiKey: boolean;
  apiKeyPrefix: string | null;
  allowedOrigins: string[];
  lastError: string | null;
  lastUsedAt: string | null;
  widgetUrl: string;
  conversationsUrl: string;
}

export interface WebChatAuthContext {
  businessId: string;
  configId: string;
  allowedOrigins: string[];
}

export interface WebChatMessageResult {
  conversationId: string;
  message: string;
  status: string;
}

export interface WebChatHistoryMessage {
  id: string;
  sender: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface WebChatConversationResult {
  conversationId: string;
  channel: 'WEB';
  status: string;
  messages: WebChatHistoryMessage[];
}
