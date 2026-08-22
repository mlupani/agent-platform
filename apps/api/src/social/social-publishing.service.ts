import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SocialInboxService } from './social-inbox.service';
import { SocialProviderFactory } from './social-provider.factory';
import { SocialAccountNotFoundError, SocialOAuthError } from './social.errors';
import type {
  SocialAccountHealth,
  SocialConnectionPublic,
  SocialContentType,
  SocialMediaKind,
  SocialPlatform,
  SocialPublishResult,
} from './social.types';
import { isSocialPlatform } from './social.types';

const OAUTH_TTL_SECONDS = 600;
const PROVIDER = 'zernio';

interface OAuthNoncePayload {
  businessId: string;
  platform: SocialPlatform;
}

interface PublishRequest {
  businessId: string;
  platform: SocialPlatform;
  contentType: SocialContentType;
  mediaUrl: string;
  mediaKind: SocialMediaKind;
  caption?: string;
}

@Injectable()
export class SocialPublishingService {
  private readonly logger = new Logger(SocialPublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly factory: SocialProviderFactory,
    private readonly config: ConfigService,
    private readonly inbox: SocialInboxService,
  ) {}

  isConfigured(): boolean {
    return this.factory.get().isConfigured();
  }

  async listConnections(businessId: string): Promise<{
    configured: boolean;
    connections: SocialConnectionPublic[];
  }> {
    const rows = await this.prisma.socialConnection.findMany({
      where: { businessId, provider: PROVIDER },
      orderBy: { platform: 'asc' },
    });
    return {
      configured: this.isConfigured(),
      connections: rows.map((row) => this.toPublicConnection(row)),
    };
  }

  async getConnectUrl(
    businessId: string,
    platform: SocialPlatform,
  ): Promise<{ authUrl: string }> {
    const provider = this.factory.get();
    const profileId = await this.ensureProfile(businessId);
    const nonce = randomBytes(32).toString('hex');
    await this.redis.set(
      this.nonceKey(nonce),
      JSON.stringify({ businessId, platform } satisfies OAuthNoncePayload),
      OAUTH_TTL_SECONDS,
    );

    const redirectUrl = this.buildRedirectUrl(nonce);
    const { authUrl } = await provider.getConnectUrl({
      platform,
      profileId,
      redirectUrl,
    });
    return { authUrl };
  }

  async handleOAuthCallback(
    query: Record<string, string | undefined>,
  ): Promise<{
    adminRedirect: string;
  }> {
    const adminBase = this.adminBaseUrl();
    const zernioError = query.error || query.error_description;
    if (zernioError) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError:
            query.error_description || query.error || 'Conexión cancelada',
        }),
      };
    }

    const nonce = query.n;
    if (!nonce) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'Falta el token de seguridad de la conexión',
        }),
      };
    }

    const raw = await this.redis.get(this.nonceKey(nonce));
    await this.redis.del(this.nonceKey(nonce));
    if (!raw) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'La conexión expiró o es inválida. Volvé a intentar.',
        }),
      };
    }

    let payload: OAuthNoncePayload;
    try {
      payload = JSON.parse(raw) as OAuthNoncePayload;
    } catch {
      throw new SocialOAuthError('Nonce de conexión corrupto');
    }

    const platform = isSocialPlatform(query.connected ?? payload.platform)
      ? ((query.connected ?? payload.platform) as SocialPlatform)
      : payload.platform;
    if (platform !== payload.platform) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'La plataforma no coincide con la conexión iniciada',
        }),
      };
    }

    const accountId = query.accountId;
    const profileId = query.profileId;
    if (!accountId) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'Zernio no devolvió la cuenta conectada',
        }),
      };
    }

    const business = await this.prisma.business.findUnique({
      where: { id: payload.businessId },
    });
    if (!business) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'Negocio no encontrado',
        }),
      };
    }
    if (
      profileId &&
      business.zernioProfileId &&
      profileId !== business.zernioProfileId
    ) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'El profile de Zernio no coincide con este negocio',
        }),
      };
    }

    const zernioProfileId = business.zernioProfileId || profileId;
    if (!zernioProfileId) {
      return {
        adminRedirect: this.adminUrl(adminBase, {
          socialError: 'Falta el profile de Zernio',
        }),
      };
    }

    let username = query.username ?? null;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    try {
      const account = await this.factory.get().getAccount(accountId);
      if (account) {
        username = account.username ?? username;
        displayName = account.displayName ?? null;
        avatarUrl = account.avatarUrl ?? null;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la cuenta Zernio ${accountId}: ${
          error instanceof Error ? error.message : 'error'
        }`,
      );
    }

    try {
      await this.upsertConnection({
        businessId: payload.businessId,
        platform,
        externalAccountId: accountId,
        zernioProfileId,
        username,
        displayName,
        avatarUrl,
        status: 'connected',
        lastError: null,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          adminRedirect: this.adminUrl(adminBase, {
            socialError: 'Esta cuenta ya está vinculada a otro negocio',
          }),
        };
      }
      throw error;
    }

    if (platform === 'instagram') {
      void this.inbox.backfillFromZernio(payload.businessId);
    }

    return {
      adminRedirect: this.adminUrl(adminBase, { connected: platform }),
    };
  }

  async disconnect(businessId: string, platform: SocialPlatform) {
    const connection = await this.prisma.socialConnection.findUnique({
      where: {
        businessId_provider_platform: {
          businessId,
          provider: PROVIDER,
          platform,
        },
      },
    });
    if (!connection) {
      throw new SocialAccountNotFoundError(platform);
    }

    try {
      await this.factory.get().disconnect(connection.externalAccountId);
    } catch (error) {
      this.logger.warn(
        `Zernio disconnect falló para ${platform}: ${
          error instanceof Error ? error.message : 'error'
        }`,
      );
    }

    const updated = await this.prisma.socialConnection.update({
      where: { id: connection.id },
      data: { status: 'disconnected', lastError: null },
    });
    if (platform === 'instagram') {
      await this.inbox.purgeChats(businessId);
    }
    return this.toPublicConnection(updated);
  }

  async setAgentEnabled(
    businessId: string,
    platform: SocialPlatform,
    agentEnabled: boolean,
  ): Promise<SocialConnectionPublic> {
    const connection = await this.requireConnection(businessId, platform);
    const updated = await this.prisma.socialConnection.update({
      where: { id: connection.id },
      data: { agentEnabled },
    });
    return this.toPublicConnection(updated);
  }

  async getHealth(
    businessId: string,
    platform: SocialPlatform,
  ): Promise<SocialAccountHealth> {
    const connection = await this.requireConnection(businessId, platform);
    return this.factory.get().getAccountHealth(connection.externalAccountId);
  }

  async publish(input: PublishRequest): Promise<SocialPublishResult> {
    const connection = await this.requireConnection(
      input.businessId,
      input.platform,
    );
    if (connection.status !== 'connected') {
      throw new SocialAccountNotFoundError(input.platform);
    }
    return this.factory.get().publish({
      accountId: connection.externalAccountId,
      platform: input.platform,
      contentType: input.contentType,
      mediaUrl: input.mediaUrl,
      mediaKind: input.mediaKind,
      caption: input.caption,
    });
  }

  async upsertFromWebhook(input: {
    accountId: string;
    profileId?: string;
    platform?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
    status: 'connected' | 'disconnected' | 'revoked';
  }): Promise<{ applied: boolean }> {
    const existing = await this.prisma.socialConnection.findUnique({
      where: {
        provider_externalAccountId: {
          provider: PROVIDER,
          externalAccountId: input.accountId,
        },
      },
    });

    if (input.status !== 'connected') {
      if (!existing) return { applied: false };
      await this.prisma.socialConnection.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          lastError: null,
        },
      });
      if (existing.platform === 'instagram') {
        await this.inbox.purgeChats(existing.businessId);
      }
      return { applied: true };
    }

    let businessId = existing?.businessId;
    if (!businessId && input.profileId) {
      const business = await this.prisma.business.findFirst({
        where: { zernioProfileId: input.profileId },
      });
      businessId = business?.id;
    }
    if (!businessId) return { applied: false };

    const platform = isSocialPlatform(
      input.platform ?? existing?.platform ?? '',
    )
      ? ((input.platform ?? existing?.platform) as SocialPlatform)
      : null;
    if (!platform) return { applied: false };

    const zernioProfileId = input.profileId || existing?.zernioProfileId;
    if (!zernioProfileId) return { applied: false };

    try {
      await this.upsertConnection({
        businessId,
        platform,
        externalAccountId: input.accountId,
        zernioProfileId,
        username: input.username ?? existing?.username ?? null,
        displayName: input.displayName ?? existing?.displayName ?? null,
        avatarUrl: input.avatarUrl ?? existing?.avatarUrl ?? null,
        status: 'connected',
        lastError: null,
      });
      return { applied: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `Webhook ignored: account ${input.accountId} belongs to another tenant`,
        );
        return { applied: false };
      }
      throw error;
    }
  }

  async updatePublicationByExternalId(
    externalId: string,
    data: { status: 'PUBLISHED' | 'FAILED'; error?: string | null },
  ): Promise<{ applied: boolean }> {
    const publication = await this.prisma.contentPublication.findFirst({
      where: { externalId },
    });
    if (!publication) return { applied: false };
    await this.prisma.contentPublication.update({
      where: { id: publication.id },
      data: {
        status: data.status,
        error: data.error ?? null,
        publishedAt:
          data.status === 'PUBLISHED' ? new Date() : publication.publishedAt,
      },
    });
    return { applied: true };
  }

  private async requireConnection(
    businessId: string,
    platform: SocialPlatform,
  ) {
    const connection = await this.prisma.socialConnection.findFirst({
      where: {
        businessId,
        provider: PROVIDER,
        platform,
      },
    });
    if (!connection || connection.status !== 'connected') {
      throw new SocialAccountNotFoundError(platform);
    }
    return connection;
  }

  private async ensureProfile(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new SocialOAuthError('Negocio no encontrado');
    }

    const provider = this.factory.get();
    if (business.zernioProfileId) {
      try {
        await provider.getProfile(business.zernioProfileId);
        return business.zernioProfileId;
      } catch {
        this.logger.warn(
          `Profile Zernio ${business.zernioProfileId} inválido, se crea uno nuevo`,
        );
      }
    }

    const created = await provider.createProfile({
      name: `novalup-${business.slug}`.slice(0, 80),
      description: business.name,
    });
    await this.prisma.business.update({
      where: { id: businessId },
      data: { zernioProfileId: created.id },
    });
    return created.id;
  }

  private toPublicConnection(row: {
    platform: string;
    status: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    lastError: string | null;
    agentEnabled?: boolean;
    updatedAt: Date;
  }): SocialConnectionPublic {
    return {
      platform: row.platform as SocialPlatform,
      status: row.status as SocialConnectionPublic['status'],
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      lastError: row.lastError,
      agentEnabled: row.agentEnabled !== false,
      updatedAt: row.updatedAt,
    };
  }

  private async upsertConnection(input: {
    businessId: string;
    platform: SocialPlatform;
    externalAccountId: string;
    zernioProfileId: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    status: string;
    lastError: string | null;
  }) {
    await this.prisma.socialConnection.upsert({
      where: {
        businessId_provider_platform: {
          businessId: input.businessId,
          provider: PROVIDER,
          platform: input.platform,
        },
      },
      create: {
        businessId: input.businessId,
        provider: PROVIDER,
        platform: input.platform,
        externalAccountId: input.externalAccountId,
        zernioProfileId: input.zernioProfileId,
        username: input.username,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        status: input.status,
        lastError: input.lastError,
      },
      update: {
        externalAccountId: input.externalAccountId,
        zernioProfileId: input.zernioProfileId,
        username: input.username,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        status: input.status,
        lastError: input.lastError,
      },
    });
  }

  private nonceKey(nonce: string): string {
    return `social:oauth:${nonce}`;
  }

  private buildRedirectUrl(nonce: string): string {
    const configured = this.config.get<string>('ZERNIO_REDIRECT_URI')?.trim();
    const fallback = `${this.config.get<string>('API_URL', 'http://localhost:3001').replace(/\/$/, '')}/api/social/oauth/callback`;
    const url = new URL(configured || fallback);
    url.searchParams.set('n', nonce);
    return url.toString();
  }

  private adminBaseUrl(): string {
    return (
      this.config.get<string>('ADMIN_URL')?.replace(/\/$/, '') ||
      'http://localhost:3000'
    );
  }

  private adminUrl(base: string, params: Record<string, string>): string {
    const url = new URL(`${base}/integrations`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
}
