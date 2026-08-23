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
  inboxSync?: 'webhook' | 'poll';
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
  period: {
    today: string;
    weekStart: string | null;
    weekEnd: string | null;
    month: string;
    monthStart: string | null;
    monthEnd: string | null;
    monthLabel: string;
    availableMonths: Array<{ value: string; label: string }>;
  };
  metrics: {
    conversationsToday: number;
    conversationsWeek: number;
    conversationsMonth: number;
    conversationsMonthDelta: number | null;
    openConversations: number;
    handoffsOpen: number;
    unreadMessages: number;
    appointmentsToday: number;
    appointmentsWeek: number;
    leadsWeek: number;
    leadsMonth: number;
    leadsMonthDelta: number | null;
    newClientsMonth: number;
    newClientsMonthDelta: number | null;
    topChannel: string | null;
    executionsWeek: number;
    inputTokensWeek: number;
    outputTokensWeek: number;
    estimatedCostWeek: number;
    avgLatencyMs: number;
    contentGeneratedMonth: number;
    contentPhotosMonth: number;
    contentVideosMonth: number;
  };
  statusMix: Array<{ status: string; count: number }>;
  channelMix: Array<{
    channel: string;
    count: number;
    leads?: number;
    share?: number;
  }>;
  channels: Array<{
    channel: string;
    conversations: number;
    leads: number;
    share: number;
    conversion: number;
  }>;
  daily: Array<{
    date: string;
    leads: number;
    clients: number;
    conversations: number;
  }>;
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

export interface ClientStatus {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
}

export interface ClientRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  status: Pick<ClientStatus, 'id' | 'slug' | 'name'>;
  appointments: number;
  conversations: number;
}

export interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  channel: string | null;
  conversationId: string | null;
  status: string;
  interest: string | null;
  isContactable: boolean;
  contactChannels: string[];
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface LeadFollowUpRow {
  id: string;
  source: string;
  objective: string;
  objectiveNote: string | null;
  status: string;
  scheduledAt: string;
  attemptNumber: number;
  channel: string | null;
  draftMessage: string | null;
  sentMessage: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface LeadEventRow {
  id: string;
  type: string;
  actor: string;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface LeadDetail extends LeadRow {
  objections: string | null;
  lostReason: string | null;
  convertedAt: string | null;
  conversionSource: string | null;
  preferredChannel: string | null;
  missingFields: string[];
  user?: {
    id: string;
    name: string | null;
    status?: { slug: string; name: string } | null;
  } | null;
  followUps: LeadFollowUpRow[];
  events: LeadEventRow[];
}

export interface LeadLifecycleConfig {
  followUpEnabled: boolean;
  conversionMode: 'manual' | 'suggested' | 'automatic';
  conversionTriggers: string[];
  followUpDelaysHours: number[];
  maxAttempts: number;
  generateWithAi: boolean;
  sendMode: 'auto' | 'review' | 'reminder_only';
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string | null;
  preferredChannel: string;
  askForMissingContact: boolean;
  convertedClientStatusSlug: string;
  trialClientStatusSlug: string;
}

export interface CatalogService {
  id: string;
  name: string;
  sessionCount: number;
  capacity?: number;
  enabled: boolean;
  durationMinutes: number;
  price?: string | number | null;
}

export interface PaymentPass {
  id: string;
  sessionCount: number;
  sessionsPaid: number;
  sessionsUsed: number;
  remaining: number;
  unusedCredits: number;
}

export interface PaymentRow {
  id: string;
  amount: number;
  paidAt: string;
  notes: string | null;
  sessionsGranted: number;
  sessionsConsumed: number;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  service: {
    id: string;
    name: string;
    sessionCount: number;
  } | null;
  pass: PaymentPass | null;
}

export interface PaymentStatsRow {
  serviceId: string | null;
  name: string;
  sessionCount: number;
  payments: number;
  amount: number;
  sessionsGranted: number;
}

export interface SpendBucket {
  cost: number;
  calls: number;
  tokens: number;
}

export interface SpendReport {
  currency: 'USD';
  period: {
    today: string;
    month: string;
    monthLabel: string;
    availableMonths: Array<{ value: string; label: string }>;
  };
  totals: {
    day: number;
    month: number;
  };
  services: Array<{
    id: string;
    name: string;
    envKey: string;
    configured: boolean;
    day: SpendBucket;
    month: SpendBucket;
    breakdown: Array<{
      label: string;
      day: SpendBucket;
      month: SpendBucket;
    }>;
  }>;
  note: string;
}
