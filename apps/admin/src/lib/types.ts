export interface Business {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  type: string;
  timezone: string;
  language: string;
  openingHours?: unknown;
  defaultMessages?: unknown;
  agentConfigs?: AgentConfig[];
  knowledgeBases?: KnowledgeBase[];
  toolConfigs?: ToolConfig[];
  _count?: { conversations: number };
}

export interface AgentConfig {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  provider: string;
  model: string;
  systemPrompt: string;
  personality?: string | null;
  temperature: number;
  maxSteps: number;
  knowledgeBaseId?: string | null;
  enabledTools: string[];
  enabledChannels: string[];
  isDefault: boolean;
}

export interface KnowledgeBase {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  _count?: { documents: number };
}

export interface ToolConfig {
  id: string;
  name: string;
  enabled: boolean;
  risk: string;
  requireConfirmation: boolean;
}

export interface ConversationUser {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface Conversation {
  id: string;
  businessId: string;
  status: string;
  channel: string;
  updatedAt: string;
  createdAt?: string;
  contactName?: string | null;
  contactUsername?: string | null;
  contactPhone?: string | null;
  contactAvatarUrl?: string | null;
  unreadCount?: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastMessageSender?: string | null;
  displayName?: string;
  botActive?: boolean;
  needsAttention?: boolean;
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
  business?: { id?: string; name: string };
  user?: ConversationUser | null;
  _count?: { messages: number };
  messages?: Message[];
}

export interface Message {
  id: string;
  role: string;
  sender?: string;
  content: string;
  createdAt: string;
  status?: string | null;
  externalId?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
}

export interface AnalyticsOverview {
  businesses: number;
  conversations: number;
  leads: number;
  executions: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface DashboardPayload {
  business: { id: string; name: string; timezone: string };
  period: { today: string; weekStart: string | null; weekEnd: string | null };
  metrics: {
    conversationsToday: number;
    conversationsWeek: number;
    openConversations: number;
    handoffsOpen: number;
    unreadMessages: number;
    appointmentsToday: number;
    appointmentsWeek: number;
    leadsWeek: number;
    executionsWeek: number;
    inputTokensWeek: number;
    outputTokensWeek: number;
    estimatedCostWeek: number;
    avgLatencyMs: number;
  };
  statusMix: Array<{ status: string; count: number }>;
  channelMix: Array<{ channel: string; count: number }>;
  recentConversations: Array<{
    id: string;
    status: string;
    channel: string;
    contactName: string | null;
    contactPhone: string | null;
    unreadCount: number;
    lastMessageAt: string | null;
    lastMessagePreview: string | null;
    lastMessageSender: string | null;
  }>;
  upcomingAppointments: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    contactName: string | null;
    contactPhone: string | null;
    service: { id: string; name: string } | null;
  }>;
}

export interface ChatResponse {
  conversationId: string;
  message: string;
  status: string;
  debug?: {
    executionId: string;
    steps: number;
    tools: Array<{
      name: string;
      input: unknown;
      output: unknown;
      success: boolean;
      durationMs?: number;
      error?: string;
      step?: number;
    }>;
    ragChunks: Array<{
      id: string;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }>;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCost: number;
    model: string;
    provider: string;
    systemPrompt?: string;
    success: boolean;
    error?: string;
  };
}

export interface RegisteredTool {
  name: string;
  description: string;
  risk: string;
}
