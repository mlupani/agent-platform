export type SocialPlatform = 'instagram' | 'tiktok';

export type SocialProviderName = 'zernio';

export type SocialConnectionStatus =
  'connected' | 'disconnected' | 'revoked' | 'error';

export type SocialContentType = 'feed' | 'story' | 'reel' | 'video';

export type SocialMediaKind = 'image' | 'video';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  profileId: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface SocialAccountHealth {
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  canPost: boolean;
  issues: string[];
}

export interface SocialConnectUrlInput {
  platform: SocialPlatform;
  profileId: string;
  redirectUrl: string;
}

export interface SocialConnectUrlResult {
  authUrl: string;
  state?: string;
}

export interface SocialCreateProfileInput {
  name: string;
  description?: string;
}

export interface SocialPublishInput {
  accountId: string;
  platform: SocialPlatform;
  contentType: SocialContentType;
  mediaUrl: string;
  mediaKind: SocialMediaKind;
  caption?: string;
}

export interface SocialPublishResult {
  externalId?: string;
  status: 'published' | 'publishing' | 'failed';
}

export interface SocialInboxSendInput {
  accountId: string;
  conversationId: string;
  message: string;
}

export interface SocialInboxThread {
  id: string;
  accountId?: string;
  participantId?: string;
  participantName?: string | null;
  participantUsername?: string | null;
  participantPicture?: string | null;
  lastMessage?: string | null;
  updatedAt?: Date | null;
  unreadCount?: number | null;
}

export interface SocialInboxMessage {
  id: string;
  conversationId?: string;
  text: string;
  fromMe: boolean;
  senderId?: string;
  senderName?: string | null;
  createdAt?: Date | null;
}

export interface SocialConnectionPublic {
  platform: SocialPlatform;
  status: SocialConnectionStatus;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  lastError: string | null;
  agentEnabled: boolean;
  updatedAt: Date;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  'instagram',
  'tiktok',
];

export function isSocialPlatform(value: string): value is SocialPlatform {
  return value === 'instagram' || value === 'tiktok';
}
