import type {
  SocialAccount,
  SocialAccountHealth,
  SocialConnectUrlInput,
  SocialConnectUrlResult,
  SocialCreateProfileInput,
  SocialPlatform,
  SocialProviderName,
  SocialPublishInput,
  SocialPublishResult,
  SocialInboxSendInput,
  SocialInboxThread,
  SocialInboxMessage,
} from './social.types';

export const SOCIAL_PROVIDERS = Symbol('SOCIAL_PROVIDERS');

export interface SocialProvider {
  readonly name: SocialProviderName;
  isConfigured(): boolean;
  createProfile(input: SocialCreateProfileInput): Promise<{ id: string }>;
  getProfile(profileId: string): Promise<{ id: string; name?: string }>;
  listProfiles?(): Promise<Array<{ id: string; name?: string }>>;
  getConnectUrl(input: SocialConnectUrlInput): Promise<SocialConnectUrlResult>;
  listAccounts(
    profileId: string,
    platform?: SocialPlatform,
  ): Promise<SocialAccount[]>;
  getAccount(accountId: string): Promise<SocialAccount | null>;
  disconnect(accountId: string): Promise<void>;
  getAccountHealth(accountId: string): Promise<SocialAccountHealth>;
  publish(input: SocialPublishInput): Promise<SocialPublishResult>;
  sendInboxMessage(
    input: SocialInboxSendInput,
  ): Promise<{ externalId?: string }>;
  listInboxThreads(input: {
    accountId: string;
    profileId?: string;
    platform?: SocialPlatform;
  }): Promise<SocialInboxThread[]>;
  listInboxMessages(input: {
    accountId: string;
    conversationId: string;
  }): Promise<SocialInboxMessage[]>;
}
