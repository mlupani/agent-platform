import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitError, Zernio, ZernioApiError } from '@zernio/node';
import type { SocialProvider } from '../social-provider.interface';
import {
  SocialAccountNotFoundError,
  SocialAuthError,
  SocialNotConfiguredError,
  SocialProviderError,
  SocialRateLimitError,
  safeSocialMessage,
} from '../social.errors';
import type {
  SocialAccount,
  SocialAccountHealth,
  SocialConnectUrlInput,
  SocialConnectUrlResult,
  SocialCreateProfileInput,
  SocialInboxSendInput,
  SocialInboxThread,
  SocialInboxMessage,
  SocialPlatform,
  SocialPublishInput,
  SocialPublishResult,
} from '../social.types';

interface ZernioAccountPayload {
  _id: string;
  platform: string;
  profileId: string | { _id?: string };
  username?: string | null;
  displayName?: string | null;
  profilePicture?: string | null;
}

interface SdkResult<T> {
  data?: T;
  error?: unknown;
}

@Injectable()
export class ZernioSocialProvider implements SocialProvider {
  readonly name = 'zernio' as const;
  private readonly logger = new Logger(ZernioSocialProvider.name);
  private readonly client: Zernio | null;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ZERNIO_API_KEY')?.trim();
    this.client = apiKey ? new Zernio({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  async createProfile(
    input: SocialCreateProfileInput,
  ): Promise<{ id: string }> {
    const data = await this.call<{ profile?: { _id?: string } }>(
      this.sdk().profiles.createProfile({
        body: {
          name: input.name,
          description: input.description,
        },
      }),
    );
    const id = data.profile?._id;
    if (!id) {
      throw new SocialProviderError('Zernio no devolvió el profile creado');
    }
    return { id };
  }

  async getProfile(profileId: string): Promise<{ id: string; name?: string }> {
    const data = await this.call<{ profile?: { _id?: string; name?: string } }>(
      this.sdk().profiles.getProfile({
        path: { profileId },
      }),
    );
    const id = data.profile?._id;
    if (!id) {
      throw new SocialAccountNotFoundError();
    }
    return { id, name: data.profile?.name };
  }

  async getConnectUrl(
    input: SocialConnectUrlInput,
  ): Promise<SocialConnectUrlResult> {
    const data = await this.call<{ authUrl?: string; state?: string }>(
      this.sdk().connect.getConnectUrl({
        path: { platform: input.platform },
        query: {
          profileId: input.profileId,
          redirect_url: input.redirectUrl,
          ...(input.platform === 'instagram'
            ? { loginMethod: 'instagram_login' as const }
            : {}),
        },
      }),
    );
    if (!data.authUrl) {
      throw new SocialProviderError('Zernio no devolvió la URL de conexión');
    }
    return { authUrl: data.authUrl, state: data.state };
  }

  async listAccounts(
    profileId: string,
    platform?: SocialPlatform,
  ): Promise<SocialAccount[]> {
    const data = await this.call<{ accounts?: ZernioAccountPayload[] }>(
      this.sdk().accounts.listAccounts({
        query: {
          profileId,
          ...(platform ? { platform } : {}),
        },
      }),
    );
    return (data.accounts ?? [])
      .filter(
        (account) =>
          account.platform === 'instagram' || account.platform === 'tiktok',
      )
      .map((account) => this.mapAccount(account));
  }

  async getAccount(accountId: string): Promise<SocialAccount | null> {
    const data = await this.call<{
      accounts?: ZernioAccountPayload[];
    }>(this.sdk().accounts.listAccounts());
    const found = (data.accounts ?? []).find(
      (account) => account._id === accountId,
    );
    if (!found) return null;
    if (found.platform !== 'instagram' && found.platform !== 'tiktok') {
      return null;
    }
    return this.mapAccount(found);
  }

  async disconnect(accountId: string): Promise<void> {
    try {
      const resolved = (await this.sdk().accounts.deleteAccount({
        path: { accountId },
      })) as SdkResult<unknown>;
      if (resolved?.error) this.throwMapped(resolved.error);
    } catch (error) {
      if (error instanceof SocialAccountNotFoundError) return;
      if (
        error instanceof SocialNotConfiguredError ||
        error instanceof SocialRateLimitError ||
        error instanceof SocialAuthError ||
        error instanceof SocialProviderError
      ) {
        throw error;
      }
      this.throwMapped(error);
    }
  }

  async getAccountHealth(accountId: string): Promise<SocialAccountHealth> {
    const data = await this.call<{
      status?: string;
      permissions?: { canPost?: boolean };
      issues?: unknown[];
    }>(
      this.sdk().accounts.getAccountHealth({
        path: { accountId },
      }),
    );
    const status =
      data.status === 'healthy' ||
      data.status === 'warning' ||
      data.status === 'error'
        ? data.status
        : 'unknown';
    return {
      status,
      canPost: data.permissions?.canPost !== false,
      issues: (data.issues ?? []).map((issue) =>
        typeof issue === 'string' ? issue : JSON.stringify(issue),
      ),
    };
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    if (input.platform === 'tiktok' && input.mediaKind !== 'video') {
      throw new SocialProviderError(
        'TikTok solo acepta video (entre 3 segundos y 10 minutos).',
      );
    }

    const platformEntry: {
      platform: string;
      accountId: string;
      platformSpecificData?: { contentType?: 'story' };
    } = {
      platform: input.platform,
      accountId: input.accountId,
    };
    if (input.platform === 'instagram' && input.contentType === 'story') {
      platformEntry.platformSpecificData = { contentType: 'story' };
    }

    const data = await this.call<{
      post?: { _id?: string; status?: string };
    }>(
      this.sdk().posts.createPost({
        body: {
          content: input.caption || undefined,
          mediaItems: [
            {
              type: input.mediaKind,
              url: input.mediaUrl,
            },
          ],
          platforms: [platformEntry],
          publishNow: true,
          ...(input.platform === 'tiktok'
            ? {
                tiktokSettings: {
                  privacyLevel: 'PUBLIC_TO_EVERYONE',
                  contentPreviewConfirmed: true,
                  expressConsentGiven: true,
                  mediaType: 'video' as const,
                },
              }
            : {}),
        },
      }),
    );

    const post = data.post;
    const status = post?.status;
    return {
      externalId: post?._id,
      status:
        status === 'failed'
          ? 'failed'
          : status === 'published'
            ? 'published'
            : 'publishing',
    };
  }

  async sendInboxMessage(
    input: SocialInboxSendInput,
  ): Promise<{ externalId?: string }> {
    const data = await this.call<{
      success?: boolean;
      data?: { messageId?: string };
    }>(
      this.sdk().messages.sendInboxMessage({
        path: { conversationId: input.conversationId },
        body: {
          accountId: input.accountId,
          message: input.message,
        },
      }),
    );
    return { externalId: data.data?.messageId };
  }

  async listInboxThreads(input: {
    accountId: string;
    profileId?: string;
  }): Promise<SocialInboxThread[]> {
    const threads: SocialInboxThread[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const payload = await this.call<unknown>(
        this.sdk().messages.listInboxConversations({
          query: {
            accountId: input.accountId,
            platform: 'instagram',
            sortOrder: 'desc',
            limit: 50,
            ...(input.profileId ? { profileId: input.profileId } : {}),
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      const record = asRecord(payload);
      logFailedInboxAccounts(this.logger, record);
      const rows = inboxRowsOf(payload);
      for (const row of rows) {
        const thread = this.mapInboxThread(row);
        if (thread.id) threads.push(thread);
      }
      const next = stringOf(asRecord(record?.pagination)?.nextCursor);
      if (!next || rows.length === 0) break;
      cursor = next;
    }
    return threads;
  }

  async listInboxMessages(input: {
    accountId: string;
    conversationId: string;
  }): Promise<SocialInboxMessage[]> {
    const payload = await this.call<unknown>(
      this.sdk().messages.getInboxConversationMessages({
        path: { conversationId: input.conversationId },
        query: {
          accountId: input.accountId,
          limit: 50,
          sortOrder: 'asc',
        },
      }),
    );
    const record = asRecord(payload);
    const rows = Array.isArray(record?.messages)
      ? record.messages.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === 'object' && !Array.isArray(row),
        )
      : inboxRowsOf(payload);
    return rows
      .map((row) => this.mapInboxMessage(row))
      .filter((message): message is SocialInboxMessage => Boolean(message?.id));
  }

  private mapInboxThread(row: Record<string, unknown>): SocialInboxThread {
    const instagramProfile = asRecord(row.instagramProfile);
    return {
      id: stringOf(row.id) ?? stringOf(row._id) ?? '',
      accountId: stringOf(row.accountId),
      participantId: stringOf(row.participantId),
      participantName: stringOf(row.participantName) ?? null,
      participantUsername:
        stringOf(row.participantUsername) ??
        stringOf(instagramProfile?.username) ??
        null,
      participantPicture: stringOf(row.participantPicture) ?? null,
      lastMessage: stringOf(row.lastMessage) ?? null,
      updatedAt: dateOf(row.updatedTime ?? row.updatedAt),
      unreadCount:
        typeof row.unreadCount === 'number' ? row.unreadCount : null,
    };
  }

  private mapInboxMessage(
    row: Record<string, unknown>,
  ): SocialInboxMessage | null {
    const attachments = row.attachments;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    const text =
      stringOf(row.message) ??
      stringOf(row.text) ??
      (hasAttachments ? '[Adjunto]' : undefined);
    const id = stringOf(row.id) ?? stringOf(row.messageId);
    if (!id || !text) return null;
    const direction = stringOf(row.direction);
    return {
      id,
      conversationId: stringOf(row.conversationId),
      text,
      fromMe: direction === 'outgoing' || direction === 'outbound',
      senderId: stringOf(row.senderId) ?? stringOf(asRecord(row.sender)?.id),
      senderName:
        stringOf(row.senderName) ?? stringOf(asRecord(row.sender)?.name) ?? null,
      createdAt: dateOf(row.createdAt ?? row.timestamp),
    };
  }

  private sdk(): Zernio {
    if (!this.client) throw new SocialNotConfiguredError();
    return this.client;
  }

  private mapAccount(account: ZernioAccountPayload): SocialAccount {
    const profileId =
      typeof account.profileId === 'string'
        ? account.profileId
        : (account.profileId?._id ?? '');
    return {
      id: account._id,
      platform: account.platform as SocialPlatform,
      profileId,
      username: account.username,
      displayName: account.displayName,
      avatarUrl: account.profilePicture,
    };
  }

  private async call<T>(result: Promise<SdkResult<T> | unknown>): Promise<T> {
    try {
      const resolved = (await result) as SdkResult<T>;
      if (resolved?.error) this.throwMapped(resolved.error);
      if (resolved?.data === undefined || resolved.data === null) {
        throw new SocialProviderError('Respuesta vacía de Zernio');
      }
      return resolved.data;
    } catch (error) {
      if (
        error instanceof SocialNotConfiguredError ||
        error instanceof SocialRateLimitError ||
        error instanceof SocialAuthError ||
        error instanceof SocialAccountNotFoundError ||
        error instanceof SocialProviderError
      ) {
        throw error;
      }
      this.throwMapped(error);
    }
  }

  private throwMapped(error: unknown): never {
    if (error instanceof RateLimitError) {
      throw new SocialRateLimitError();
    }
    if (error instanceof ZernioApiError) {
      if (error.isAuthError() || error.statusCode === 401) {
        throw new SocialAuthError();
      }
      if (error.isNotFound() || error.statusCode === 404) {
        throw new SocialAccountNotFoundError();
      }
      this.logger.warn(`Zernio API error ${error.statusCode}: ${error.message}`);
      throw new SocialProviderError(safeSocialMessage(error.message));
    }

    const status = statusOf(error);
    const message =
      error instanceof Error ? error.message : 'Error al hablar con Zernio';
    if (status === 429) throw new SocialRateLimitError();
    if (status === 401 || status === 403) throw new SocialAuthError();
    if (status === 404) throw new SocialAccountNotFoundError();
    this.logger.warn(`Zernio error: ${message}`);
    throw new SocialProviderError(safeSocialMessage(message));
  }
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: number; statusCode?: number };
  return candidate.statusCode ?? candidate.status;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function logFailedInboxAccounts(
  logger: Logger,
  record: Record<string, unknown> | null,
) {
  const meta = asRecord(record?.meta);
  const failed = meta?.failedAccounts;
  if (!Array.isArray(failed) || failed.length === 0) return;
  logger.warn(
    `Zernio inbox accounts failed: ${failed
      .map((item) => {
        const row = asRecord(item);
        return `${stringOf(row?.accountId) ?? '?'}:${stringOf(row?.error) ?? 'error'}`;
      })
      .join(', ')}`,
  );
}

function inboxRowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    );
  }
  const record = asRecord(payload);
  const nested = record?.data;
  if (!Array.isArray(nested)) return [];
  return nested.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}
