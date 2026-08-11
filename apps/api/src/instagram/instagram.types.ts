export interface InstagramPublicConfig {
  id: string;
  businessId: string;
  enabled: boolean;
  status: string;
  username: string | null;
  userId: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  hasSession: boolean;
  apiUrlConfigured: boolean;
}

export interface InstagramNormalizedInbound {
  channel: 'INSTAGRAM';
  externalUserId: string;
  externalUsername?: string;
  externalConversationId: string;
  externalMessageId: string;
  text: string;
  contactName?: string;
  contactAvatarUrl?: string;
  timestamp?: Date | null;
  fromMe: boolean;
}

export interface InstagramThreadUser {
  pk?: string | number;
  id?: string | number;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
}

export interface InstagramDirectMessage {
  id?: string | number;
  item_id?: string | number;
  user_id?: string | number;
  text?: string | null;
  timestamp?: string | number | null;
  item_type?: string;
  is_sent_by_viewer?: boolean;
}

export interface InstagramDirectThread {
  id?: string | number;
  thread_id?: string | number;
  users?: InstagramThreadUser[];
  messages?: InstagramDirectMessage[];
  last_activity_at?: string | number | null;
}
