import { createHmac, timingSafeEqual } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis/redis.service';
import { SocialError, SocialWebhookSignatureError } from './social.errors';
import { SocialCommentService } from './social-comment.service';
import { SocialInboxService } from './social-inbox.service';
import { SocialPublishingService } from './social-publishing.service';

const EVENT_TTL_SECONDS = 86_400;

export interface SocialWebhookHandleInput {
  rawBody: Buffer;
  signature?: string;
  eventId?: string;
  payload: unknown;
}

@Injectable()
export class SocialWebhookService {
  private readonly logger = new Logger(SocialWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly publishing: SocialPublishingService,
    private readonly inbox: SocialInboxService,
    private readonly comments: SocialCommentService,
  ) {}

  async handle(input: SocialWebhookHandleInput): Promise<{
    ok: true;
    duplicate?: boolean;
    applied?: boolean;
  }> {
    const secret = this.config.get<string>('ZERNIO_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      throw new SocialError(
        'Falta ZERNIO_WEBHOOK_SECRET en el servidor.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      !input.signature ||
      !this.verifySignature(input.rawBody, input.signature, secret)
    ) {
      throw new SocialWebhookSignatureError();
    }

    if (input.eventId) {
      const locked = await this.redis.acquireLock(
        `zernio:event:${input.eventId}`,
        EVENT_TTL_SECONDS,
      );
      if (!locked) {
        return { ok: true, duplicate: true };
      }
    }

    try {
      const applied = await this.dispatch(input.payload);
      return { ok: true, applied };
    } catch (error) {
      if (input.eventId) {
        await this.redis.releaseLock(`zernio:event:${input.eventId}`);
      }
      throw error;
    }
  }

  verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
    const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
    const incoming = signature
      .replace(/^sha256=/i, '')
      .trim()
      .toLowerCase();
    if (!incoming || incoming.length !== digest.length) return false;
    return timingSafeEqual(Buffer.from(incoming), Buffer.from(digest));
  }

  private async dispatch(payload: unknown): Promise<boolean> {
    const event = asRecord(payload);
    if (!event) return false;
    const type = stringOf(event.event) ?? stringOf(event.type);
    const data = asRecord(event.data) ?? asRecord(event.account) ?? event;

    if (type === 'account.connected' || type === 'account.disconnected') {
      const accountId =
        stringOf(data.accountId) ??
        stringOf(data.account_id) ??
        stringOf(data._id);
      if (!accountId) {
        this.logger.warn(`Webhook ${type} sin accountId`);
        return false;
      }
      const result = await this.publishing.upsertFromWebhook({
        accountId,
        profileId: stringOf(data.profileId) ?? stringOf(data.profile_id),
        platform: stringOf(data.platform),
        username: stringOf(data.username),
        displayName: stringOf(data.displayName) ?? stringOf(data.display_name),
        avatarUrl:
          stringOf(data.avatarUrl) ??
          stringOf(data.profilePicture) ??
          stringOf(data.profile_picture),
        status: type === 'account.connected' ? 'connected' : 'disconnected',
      });
      return result.applied;
    }

    if (type === 'post.published' || type === 'post.failed') {
      const postId =
        stringOf(data.postId) ?? stringOf(data.post_id) ?? stringOf(data._id);
      if (!postId) return false;
      const result = await this.publishing.updatePublicationByExternalId(
        postId,
        {
          status: type === 'post.published' ? 'PUBLISHED' : 'FAILED',
          error:
            type === 'post.failed'
              ? (stringOf(data.error) ??
                stringOf(data.message) ??
                'Publicación fallida')
              : null,
        },
      );
      return result.applied;
    }

    if (type === 'message.received' || type === 'message.sent') {
      return this.inbox.handleMessageEvent(payload);
    }

    if (
      type === 'comment.received' ||
      type === 'comment.created' ||
      type === 'inbox.comment' ||
      type === 'comments.received' ||
      (type && type.includes('comment'))
    ) {
      return this.comments.handleRaw(payload);
    }

    this.logger.debug(`Webhook Zernio ignorado: ${type ?? 'unknown'}`);
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
