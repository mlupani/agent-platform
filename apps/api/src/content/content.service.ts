import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { SocialPublishingService } from '../social/social-publishing.service';
import { WahaWhatsAppProvider } from '../whatsapp/providers/waha.whatsapp-provider';
import { ContentAgentService } from './content-agent.service';
import { ContentAutoGenerateScheduler } from './content-auto-generate.scheduler';
import { ContentNotifyService } from './content-notify.service';
import {
  CONTENT_VIDEO_JOB,
  CONTENT_VIDEO_QUEUE,
} from './content-video-generate.queue';
import {
  IMAGE_GENERATION_PROVIDER,
  type ImageGenerationProvider,
} from './image/image-generation.provider';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './storage/storage.provider';
import { VideoRoutingService } from './video/video-routing.service';
import { parseVideoDuration } from './video/video-duration';
import { enrichMarketingVideoPrompt } from './video/enrich-video-prompt';
import { downloadBinary } from './video/video-http';
import { VideoEditorService } from './video-editor/video-editor.service';
import { normalizeVideoEditing } from './video-editor/normalize-editing';
import { normalizeHashtags } from './video-editor/text-overlay';
import { BrandingRenderer } from './branding/branding-renderer.service';
import type {
  ContentAssetFormat,
  ContentChannel,
  ContentMediaType,
  ContentObjective,
  ContentStatus,
  ContentStrategy,
  ContentStyle,
  VideoEditingPlan,
} from './content.types';

const OBJECTIVES = new Set([
  'AUTOMATIC',
  'SERVICE_PROMOTION',
  'OFFER',
  'TIP',
  'INFO',
  'SPECIAL_DATE',
  'CUSTOM',
]);

const CONTENT_STYLES = new Set([
  'AUTO',
  'EDUCATIONAL',
  'COMEDY',
  'SALES',
]);

const CHANNELS = new Set([
  'WHATSAPP_STATUS',
  'INSTAGRAM_STORY',
  'INSTAGRAM_FEED',
  'INSTAGRAM_REEL',
  'FACEBOOK_STORY',
  'FACEBOOK_FEED',
  'FACEBOOK_REEL',
  'TIKTOK',
]);

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly contentAgent: ContentAgentService,
    private readonly realtime: RealtimeEventsService,
    private readonly waha: WahaWhatsAppProvider,
    private readonly social: SocialPublishingService,
    private readonly autoGenerateScheduler: ContentAutoGenerateScheduler,
    private readonly notify: ContentNotifyService,
    private readonly videos: VideoRoutingService,
    private readonly videoEditor: VideoEditorService,
    private readonly brandingRenderer: BrandingRenderer,
    private readonly config: ConfigService,
    @InjectQueue(CONTENT_VIDEO_QUEUE)
    private readonly videoQueue: Queue,
    @Inject(IMAGE_GENERATION_PROVIDER)
    private readonly images: ImageGenerationProvider,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {}

  async summary() {
    const businessId = await this.businesses.getCurrentId();
    const zone = await this.businessTimezone(businessId);
    const monthStart = DateTime.now().setZone(zone).startOf('month').toUTC();

    const [generatedMonth, published, scheduled, drafts, failed] =
      await Promise.all([
        this.prisma.generatedContent.count({
          where: {
            businessId,
            createdAt: { gte: monthStart.toJSDate() },
            status: { not: 'FAILED' },
          },
        }),
        this.prisma.generatedContent.count({
          where: {
            businessId,
            status: { in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'] },
          },
        }),
        this.prisma.generatedContent.count({
          where: { businessId, status: 'SCHEDULED' },
        }),
        this.prisma.generatedContent.count({
          where: { businessId, status: { in: ['DRAFT', 'READY'] } },
        }),
        this.prisma.generatedContent.count({
          where: { businessId, status: 'FAILED' },
        }),
      ]);

    const [costAgg, imageGenerationsThisMonth, videoGenerationsThisMonth] =
      await Promise.all([
        this.prisma.contentGenerationExecution.aggregate({
          where: {
            businessId,
            createdAt: { gte: monthStart.toJSDate() },
            success: true,
            content: { status: { not: 'FAILED' } },
          },
          _sum: { estimatedCost: true },
        }),
        this.prisma.contentAsset.count({
          where: {
            createdAt: { gte: monthStart.toJSDate() },
            type: 'IMAGE',
            content: {
              businessId,
              status: { not: 'FAILED' },
            },
          },
        }),
        this.prisma.contentAsset.count({
          where: {
            createdAt: { gte: monthStart.toJSDate() },
            type: 'VIDEO',
            content: {
              businessId,
              status: { not: 'FAILED' },
            },
          },
        }),
      ]);

    return {
      generatedThisMonth: generatedMonth,
      published,
      scheduled,
      drafts,
      failed,
      imageGenerationsThisMonth,
      videoGenerationsThisMonth,
      estimatedCostThisMonth: Number(costAgg._sum.estimatedCost ?? 0),
    };
  }

  async list(params?: { status?: string; take?: number }) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.generatedContent.findMany({
      where: {
        businessId,
        ...(params?.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params?.take ?? 50,
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        service: { select: { id: true, name: true } },
        publications: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async get(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const content = await this.prisma.generatedContent.findFirst({
      where: { id, businessId },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        service: { select: { id: true, name: true } },
        executions: { orderBy: { createdAt: 'desc' }, take: 20 },
        publications: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!content) throw new NotFoundException('Contenido no encontrado');
    return content;
  }

  async autoEdit(
    id: string,
    input: { headline?: string; cta?: string; hook?: string } = {},
  ) {
    const businessId = await this.businesses.getCurrentId();
    let content = await this.prisma.generatedContent.findFirst({
      where: { id, businessId },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!content) throw new NotFoundException('Contenido no encontrado');
    if (['GENERATING', 'PUBLISHING'].includes(content.status)) {
      throw new BadRequestException('El contenido se está procesando');
    }

    const headline = input.headline?.trim();
    const cta = input.cta?.trim();
    const hook = input.hook?.trim();
    if (headline !== undefined || cta !== undefined || hook !== undefined) {
      content = await this.prisma.generatedContent.update({
        where: { id: content.id },
        data: {
          ...(input.headline !== undefined
            ? { headline: headline || null }
            : {}),
          ...(input.cta !== undefined ? { cta: cta || null } : {}),
          ...(input.hook !== undefined ? { hook: hook || null } : {}),
        },
        include: {
          assets: { orderBy: { createdAt: 'desc' } },
        },
      });
    }

    const videos = content.assets.filter(
      (asset) => (asset.type ?? 'IMAGE').toUpperCase() === 'VIDEO',
    );
    const original =
      videos.find((asset) => asset.role === 'ORIGINAL') ??
      videos.find((asset) => asset.role !== 'EDITED') ??
      videos[0];
    if (!original?.storageUrl) {
      throw new BadRequestException(
        'Este contenido no tiene un video original para autoeditar',
      );
    }

    const branding = await this.prisma.brandingConfig.findUnique({
      where: { businessId },
      select: { logoUrl: true, primaryColor: true },
    });
    const logoUrl = branding?.logoUrl?.trim() || null;
    const strategy = this.strategyFromStored(content);
    strategy.editing = {
      ...strategy.editing,
      add_hook: Boolean(strategy.hook),
      add_cta: Boolean(strategy.cta),
      add_logo: Boolean(logoUrl),
    };

    if (!content.hook && strategy.hook) {
      await this.prisma.generatedContent.update({
        where: { id: content.id },
        data: { hook: strategy.hook },
      });
    }

    const downloaded = await downloadBinary(original.storageUrl);
    await this.applyVideoAutoEdit({
      contentId: content.id,
      businessId,
      originalBuffer: downloaded.buffer,
      mimeType: downloaded.mimeType,
      strategy,
      logoUrl,
      primaryColor: branding?.primaryColor,
      currentStatus: content.status,
      throwOnError: true,
      forceMotion: true,
      preserveEditedOnSkip: true,
    });

    return this.get(content.id);
  }

  async uploadReferenceImages(
    files: Array<{ buffer: Buffer; mimetype: string; originalname: string }>,
  ) {
    if (!files?.length) {
      throw new BadRequestException('Subí al menos una imagen');
    }
    if (files.length > 4) {
      throw new BadRequestException('Máximo 4 imágenes de referencia');
    }

    const businessId = await this.businesses.getCurrentId();
    const folder = `${this.cloudinaryRoot()}/${businessId}/references`;
    const urls: string[] = [];

    for (const [index, file] of files.entries()) {
      if (!file.mimetype?.startsWith('image/')) {
        throw new BadRequestException(
          `Archivo inválido: ${file.originalname || index + 1}`,
        );
      }
      if (file.buffer.length > 8 * 1024 * 1024) {
        throw new BadRequestException('Cada imagen debe pesar menos de 8MB');
      }
      const uploaded = await this.storage.upload({
        buffer: file.buffer,
        mimeType: file.mimetype,
        folder,
        publicId: `ref-${Date.now()}-${index}`,
      });
      urls.push(uploaded.url);
    }

    return { urls };
  }

  async uploadBrandingLogo(file: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
  }) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Subí un archivo de logo');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('El logo debe ser una imagen (PNG, JPG, SVG, WEBP)');
    }
    if (file.buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('El logo debe pesar menos de 8MB');
    }

    const businessId = await this.businesses.getCurrentId();
    const folder = `${this.cloudinaryRoot()}/${businessId}/branding`;
    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      folder,
      publicId: `logo-${Date.now()}`,
    });

    const branding = await this.prisma.brandingConfig.upsert({
      where: { businessId },
      create: { businessId, logoUrl: uploaded.url },
      update: { logoUrl: uploaded.url },
    });

    return branding;
  }

  async suggestBrief(input: {
    objective: string;
    channels?: string[];
    userInstructions?: string;
    serviceId?: string;
    mediaType?: ContentMediaType;
    durationSeconds?: number;
    contentStyle?: string;
  }) {
    const businessId = await this.businesses.getCurrentId();
    const mediaType = this.parseMediaType(input.mediaType);
    const objective = this.parseObjective(input.objective);
    const contentStyle = this.parseContentStyle(input.contentStyle);
    const channels = input.channels?.length
      ? this.parseChannels(input.channels)
      : [];
    const durationSeconds =
      mediaType === 'VIDEO' ? parseVideoDuration(input.durationSeconds, 5) : 5;

    try {
      const result = await this.contentAgent.suggestBrief({
        businessId,
        objective,
        channels,
        mediaType,
        durationSeconds,
        serviceId: input.serviceId,
        hint: input.userInstructions,
        contentStyle,
      });

      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId,
          stage: 'brief',
          provider: result.provider,
          model: result.model,
          success: true,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCost: result.estimatedCost,
          durationMs: result.durationMs,
          metadata: {
            objective,
            mediaType,
            contentStyle,
            durationSeconds: mediaType === 'VIDEO' ? durationSeconds : null,
          },
        },
      });

      return { instructions: result.instructions };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo armar el guion';
      this.logger.warn(`suggestBrief falló: ${message}`);
      throw new BadRequestException(
        'No se pudo armar el guion. Probá de nuevo en unos segundos.',
      );
    }
  }

  async generate(input: {
    objective: string;
    channels: string[];
    userInstructions?: string;
    serviceId?: string;
    contentId?: string;
    referenceImageUrls?: string[];
    businessId?: string;
    generationMode?: 'MANUAL' | 'AUTOMATIC';
    mediaType?: ContentMediaType;
    durationSeconds?: number;
    contentStyle?: string;
  }) {
    const businessId =
      input.businessId ?? (await this.businesses.getCurrentId());
    const generationMode = input.generationMode ?? 'MANUAL';
    const mediaType = this.parseMediaType(input.mediaType);
    const durationSeconds =
      mediaType === 'VIDEO'
        ? parseVideoDuration(
            input.durationSeconds,
            parseVideoDuration(
              this.config.get<string>('VIDEO_DURATION_SECONDS'),
              5,
            ),
          )
        : null;
    const objective = this.parseObjective(input.objective);
    const contentStyle = this.parseContentStyle(input.contentStyle);
    const channels = this.parseChannels(input.channels);
    if (!channels.length) {
      throw new BadRequestException('Seleccioná al menos un canal');
    }

    await this.assertGenerationLimits(businessId);

    let content = input.contentId
      ? await this.prisma.generatedContent.findFirst({
          where: { id: input.contentId, businessId },
        })
      : null;

    if (input.contentId && !content) {
      throw new NotFoundException('Contenido no encontrado');
    }

    const referenceImageUrls = this.normalizeReferenceUrls(
      input.referenceImageUrls !== undefined
        ? input.referenceImageUrls
        : (content?.referenceImageUrls ?? []),
    );

    const strategySeed = {
      contentStyleRequest: contentStyle,
    } as Prisma.InputJsonValue;

    if (!content) {
      content = await this.prisma.generatedContent.create({
        data: {
          businessId,
          objective,
          channels,
          userInstructions: input.userInstructions?.trim() || null,
          serviceId: input.serviceId || null,
          referenceImageUrls,
          status: 'GENERATING',
          generationMode,
          mediaType,
          durationSeconds,
          strategy: strategySeed,
        },
      });
    } else {
      content = await this.prisma.generatedContent.update({
        where: { id: content.id },
        data: {
          objective,
          channels,
          userInstructions: input.userInstructions?.trim() || null,
          serviceId: input.serviceId || null,
          ...(input.referenceImageUrls !== undefined
            ? { referenceImageUrls }
            : {}),
          status: 'GENERATING',
          generationMode,
          mediaType,
          durationSeconds,
          strategy: strategySeed,
          error: null,
          autoEditStatus: null,
          autoEditError: null,
        },
      });
    }

    this.realtime.emit(
      'content.generation.started',
      { contentId: content.id, mediaType },
      businessId,
    );

    if (mediaType === 'VIDEO') {
      await this.videoQueue.add(
        CONTENT_VIDEO_JOB,
        { contentId: content.id, businessId },
        {
          jobId: `video:${content.id}:${Date.now()}`,
          attempts: 1,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
      return this.prisma.generatedContent.findFirstOrThrow({
        where: { id: content.id },
        include: {
          assets: { orderBy: { createdAt: 'desc' } },
          service: { select: { id: true, name: true } },
        },
      });
    }

    try {
      return await this.runGenerationPipeline({
        contentId: content.id,
        businessId,
        objective,
        channels,
        userInstructions: input.userInstructions,
        serviceId: input.serviceId,
        referenceImageUrls,
        mediaType,
        durationSeconds: input.durationSeconds,
        contentStyle,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error al generar';
      await this.markGenerationFailed(content.id, businessId, message);
      throw new BadRequestException(message);
    }
  }

  async processQueuedGeneration(contentId: string, businessId: string) {
    const content = await this.prisma.generatedContent.findFirst({
      where: { id: contentId, businessId },
    });
    if (!content) return;
    try {
      const ready = await this.runGenerationPipeline({
        contentId: content.id,
        businessId,
        objective: this.parseObjective(content.objective),
        channels: this.parseChannels(content.channels),
        userInstructions: content.userInstructions ?? undefined,
        serviceId: content.serviceId ?? undefined,
        referenceImageUrls: content.referenceImageUrls,
        mediaType: this.parseMediaType(content.mediaType),
        durationSeconds: content.durationSeconds,
        contentStyle: this.contentStyleFromStrategy(content.strategy),
      });
      if (content.generationMode === 'AUTOMATIC' && ready) {
        await this.notify.notifyAutoGeneration({
          businessId,
          contentId: ready.id,
          mediaType: ready.mediaType,
          headline: ready.headline,
          topic: ready.topic,
          status: ready.status,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error al generar';
      await this.markGenerationFailed(content.id, businessId, message);
      if (content.generationMode === 'AUTOMATIC') {
        await this.notify.notifyAutoGeneration({
          businessId,
          contentId: content.id,
          mediaType: content.mediaType,
          status: 'FAILED',
          error: message,
        });
      }
    }
  }

  private async runGenerationPipeline(input: {
    contentId: string;
    businessId: string;
    objective: ContentObjective;
    channels: ContentChannel[];
    userInstructions?: string;
    serviceId?: string;
    referenceImageUrls: string[];
    mediaType: ContentMediaType;
    durationSeconds?: number | null;
    contentStyle?: ContentStyle;
  }) {
    const { contentId, businessId, objective, channels, mediaType } = input;
    const referenceImageUrls = input.referenceImageUrls;
    const contentStyle = input.contentStyle ?? 'AUTO';

    const strategyResult = await this.contentAgent.buildStrategy({
      businessId,
      objective,
      channels,
      userInstructions: input.userInstructions,
      serviceId: input.serviceId,
      referenceImageUrls,
      mediaType,
      durationSeconds: parseVideoDuration(input.durationSeconds, 5),
      contentStyle,
    });

    await this.prisma.contentGenerationExecution.create({
      data: {
        businessId,
        contentId,
        stage: 'strategy',
        provider: strategyResult.provider,
        model: strategyResult.model,
        success: true,
        inputTokens: strategyResult.inputTokens,
        outputTokens: strategyResult.outputTokens,
        estimatedCost: strategyResult.estimatedCost,
        durationMs: strategyResult.durationMs,
      },
    });

    const branding = await this.prisma.brandingConfig.findUnique({
      where: { businessId },
      select: { logoUrl: true, primaryColor: true, secondaryColor: true },
    });
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    const businessName = business?.name?.trim() || 'the business';
    const logoUrl = branding?.logoUrl?.trim() || null;

    // LOGO NO se envía como reference image al modelo — se aplica después vía BrandingRenderer (Sharp)
    // HasLogo solo se usa como metadata para el prompt (sin pedir recreación)
    const imageRefUrls = this.normalizeReferenceUrls(referenceImageUrls);

    if (mediaType === 'VIDEO') {
      await this.generateVideoAsset({
        contentId,
        businessId,
        prompt: enrichMarketingVideoPrompt({
          basePrompt:
            strategyResult.strategy.videoPrompt ||
            strategyResult.strategy.imagePrompt,
          durationSeconds: parseVideoDuration(input.durationSeconds, 5),
        }),
        referenceImageUrls: imageRefUrls,
        durationSeconds: parseVideoDuration(input.durationSeconds, 5),
        strategy: strategyResult.strategy,
        logoUrl,
        primaryColor: branding?.primaryColor,
      });
    } else {
      const referenceImages =
        await this.loadReferenceImageBuffers(imageRefUrls);

      const marketingPrompt = this.enrichMarketingImagePrompt({
        basePrompt: strategyResult.strategy.imagePrompt,
        headline: strategyResult.strategy.headline,
        objective,
        businessName,
        hasLogo: Boolean(logoUrl),
        primaryColor: branding?.primaryColor,
        secondaryColor: branding?.secondaryColor,
      });

      const formats = this.resolveFormats(channels);
      for (const format of formats) {
        await this.generateImageAsset({
          contentId,
          businessId,
          format,
          prompt: marketingPrompt,
          referenceImages,
          logoUrl,
          headline: strategyResult.strategy.headline,
        });
      }
    }

    const updated = await this.prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        status: 'READY',
        topic: strategyResult.strategy.topic,
        headline: strategyResult.strategy.headline,
        hook:
          strategyResult.strategy.hook?.trim() ||
          (mediaType === 'VIDEO' ? strategyResult.strategy.headline : null),
        caption: strategyResult.strategy.caption,
        cta: strategyResult.strategy.cta,
        hashtags: normalizeHashtags(strategyResult.strategy.hashtags),
        imagePrompt: strategyResult.strategy.imagePrompt,
        videoPrompt: strategyResult.strategy.videoPrompt ?? null,
        visualStyle: strategyResult.strategy.visualStyle,
        strategy: strategyResult.strategy as unknown as Prisma.InputJsonValue,
        serviceId: strategyResult.strategy.serviceId || input.serviceId || null,
        error: null,
      },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        service: { select: { id: true, name: true } },
      },
    });

    this.realtime.emit(
      'content.generation.completed',
      { contentId: updated.id, status: updated.status },
      businessId,
    );
    this.realtime.emit(
      'content.updated',
      { contentId: updated.id, status: updated.status },
      businessId,
    );

    return updated;
  }

  private async generateImageAsset(input: {
    contentId: string;
    businessId: string;
    format: ContentAssetFormat;
    prompt: string;
    referenceImages: Array<{
      buffer: Buffer;
      mimeType: string;
      filename: string;
    }>;
    logoUrl?: string | null;
    headline?: string | null;
  }) {
    const size = this.sizeForFormat(input.format);
    const image = await this.images.generate({
      prompt: input.prompt,
      size,
      quality: 'medium',
      referenceImages:
        input.referenceImages.length > 0 ? input.referenceImages : undefined,
    });

    this.logger.log('[IMAGE GENERATION] Generated image successfully');

    let finalBuffer = image.buffer;
    let finalMimeType = image.mimeType;
    const hasLogo = Boolean(input.logoUrl?.trim());
    const hasHeadline = Boolean(input.headline?.trim());
    if (hasLogo || hasHeadline) {
      try {
        const branded = await this.brandingRenderer.apply({
          imageBuffer: image.buffer,
          logoUrl: input.logoUrl,
          headline: input.headline,
          mimeType: image.mimeType,
        });
        if (branded.applied) {
          finalBuffer = branded.buffer;
          finalMimeType = branded.mimeType;
        }
      } catch (error) {
        this.logger.warn(
          `[BRANDING] Failed to apply branding, using original: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    } else {
      this.logger.log('[BRANDING] Logo found: false — skipping branding (no logo, no headline)');
    }

    const uploaded = await this.storage.upload({
      buffer: finalBuffer,
      mimeType: finalMimeType,
      folder: `${this.cloudinaryRoot()}/${input.businessId}/content`,
      publicId: `${input.contentId}-${input.format}-${Date.now()}`,
    });

    await this.prisma.contentAsset.create({
      data: {
        contentId: input.contentId,
        type: 'IMAGE',
        format: input.format,
        aspectRatio: this.aspectForFormat(input.format),
        width: image.width ?? uploaded.width,
        height: image.height ?? uploaded.height,
        storageUrl: uploaded.url,
        storagePublicId: uploaded.publicId,
        provider: image.provider,
        model: image.model,
        generationPrompt: image.prompt,
        generationCost: image.estimatedCost,
      },
    });

    await this.prisma.contentGenerationExecution.create({
      data: {
        businessId: input.businessId,
        contentId: input.contentId,
        stage: 'image',
        provider: image.provider,
        model: image.model,
        success: true,
        inputTokens: image.inputTokens,
        outputTokens: image.outputTokens,
        estimatedCost: image.estimatedCost,
        durationMs: image.durationMs,
        metadata: { format: input.format, size },
      },
    });
  }

  private async generateVideoAsset(input: {
    contentId: string;
    businessId: string;
    prompt: string;
    referenceImageUrls: string[];
    durationSeconds: number;
    strategy: ContentStrategy;
    logoUrl: string | null;
    primaryColor?: string | null;
  }) {
    const durationSeconds = input.durationSeconds;
    const aspectRatio = (this.config.get<string>('VIDEO_ASPECT_RATIO') ||
      '9:16') as '9:16' | '16:9' | '1:1';
    const resolution = (this.config.get<string>('VIDEO_RESOLUTION') ||
      '720p') as '480p' | '720p' | '1080p';
    const generateAudio =
      (this.config.get<string>('VIDEO_GENERATE_AUDIO') ?? 'true')
        .trim()
        .toLowerCase() !== 'false';

    const video = await this.videos.generate({
      prompt: input.prompt,
      aspectRatio,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 5,
      resolution,
      generateAudio,
      referenceImageUrls: input.referenceImageUrls.slice(0, 2),
    });

    const uploaded = await this.storage.upload({
      buffer: video.buffer,
      mimeType: video.mimeType,
      folder: `${this.cloudinaryRoot()}/${input.businessId}/content`,
      publicId: `${input.contentId}-short-${Date.now()}`,
      resourceType: 'video',
    });

    await this.prisma.contentAsset.create({
      data: {
        contentId: input.contentId,
        type: 'VIDEO',
        role: 'ORIGINAL',
        format: 'SHORT_VERTICAL',
        aspectRatio,
        width: video.width ?? uploaded.width,
        height: video.height ?? uploaded.height,
        storageUrl: uploaded.url,
        storagePublicId: uploaded.publicId,
        provider: video.provider,
        model: video.model,
        generationPrompt: video.prompt,
        generationCost: video.estimatedCost,
      },
    });

    await this.prisma.contentGenerationExecution.create({
      data: {
        businessId: input.businessId,
        contentId: input.contentId,
        stage: 'video',
        provider: video.provider,
        model: video.model,
        success: true,
        estimatedCost: video.estimatedCost,
        durationMs: video.durationMs,
        metadata: {
          format: 'SHORT_VERTICAL',
          aspectRatio,
          durationSeconds: video.durationSeconds,
          usedFallback: video.usedFallback ?? false,
        },
      },
    });

    await this.applyVideoAutoEdit({
      contentId: input.contentId,
      businessId: input.businessId,
      originalBuffer: video.buffer,
      mimeType: video.mimeType,
      strategy: input.strategy,
      logoUrl: input.logoUrl,
      primaryColor: input.primaryColor,
      expectedDurationSeconds: video.durationSeconds ?? durationSeconds,
      currentStatus: 'GENERATING',
    });
  }

  private async applyVideoAutoEdit(input: {
    contentId: string;
    businessId: string;
    originalBuffer: Buffer;
    mimeType: string;
    strategy: ContentStrategy;
    logoUrl: string | null;
    primaryColor?: string | null;
    expectedDurationSeconds?: number;
    currentStatus?: string;
    throwOnError?: boolean;
    forceMotion?: boolean;
    preserveEditedOnSkip?: boolean;
  }) {
    const started = Date.now();
    const instructions = {
      ...normalizeVideoEditing({
        strategy: input.strategy,
        durationSeconds: input.expectedDurationSeconds ?? 12,
        hasLogo: Boolean(input.logoUrl),
      }),
      forceMotion: input.forceMotion,
    };
    const status = input.currentStatus ?? 'GENERATING';

    await this.prisma.generatedContent.update({
      where: { id: input.contentId },
      data: { autoEditStatus: 'PROCESSING', autoEditError: null },
    });
    this.realtime.emit(
      'content.updated',
      {
        contentId: input.contentId,
        status,
        autoEditStatus: 'PROCESSING',
      },
      input.businessId,
    );

    try {
      const edited = await this.videoEditor.edit({
        videoBuffer: input.originalBuffer,
        mimeType: input.mimeType,
        instructions,
        branding: { logoUrl: input.logoUrl, primaryColor: input.primaryColor },
        expectedDurationSeconds: input.expectedDurationSeconds,
      });

      if (edited.skipped || !edited.buffer) {
        if (!input.preserveEditedOnSkip) {
          await this.removeEditedAssets(input.contentId);
        }
        await this.prisma.generatedContent.update({
          where: { id: input.contentId },
          data: { autoEditStatus: 'SKIPPED', autoEditError: null },
        });
        await this.prisma.contentGenerationExecution.create({
          data: {
            businessId: input.businessId,
            contentId: input.contentId,
            stage: 'video-edit',
            provider: 'ffmpeg',
            model: 'auto-editor',
            success: true,
            durationMs: Date.now() - started,
            metadata: { skipped: true, operations: edited.operations },
          },
        });
        this.realtime.emit(
          'content.updated',
          {
            contentId: input.contentId,
            status,
            autoEditStatus: 'SKIPPED',
          },
          input.businessId,
        );
        return;
      }

      const uploaded = await this.storage.upload({
        buffer: edited.buffer,
        mimeType: edited.mimeType,
        folder: `${this.cloudinaryRoot()}/${input.businessId}/content`,
        publicId: `${input.contentId}-short-edited-${Date.now()}`,
        resourceType: 'video',
      });

      await this.removeEditedAssets(input.contentId);
      await this.prisma.contentAsset.create({
        data: {
          contentId: input.contentId,
          type: 'VIDEO',
          role: 'EDITED',
          format: 'SHORT_VERTICAL',
          aspectRatio: '9:16',
          width: edited.width || uploaded.width,
          height: edited.height || uploaded.height,
          storageUrl: uploaded.url,
          storagePublicId: uploaded.publicId,
          provider: 'ffmpeg',
          model: 'auto-editor',
          generationPrompt: input.strategy.videoPrompt ?? null,
        },
      });

      await this.prisma.generatedContent.update({
        where: { id: input.contentId },
        data: { autoEditStatus: 'COMPLETED', autoEditError: null },
      });
      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId: input.businessId,
          contentId: input.contentId,
          stage: 'video-edit',
          provider: 'ffmpeg',
          model: 'auto-editor',
          success: true,
          durationMs: Date.now() - started,
          metadata: {
            operations: edited.operations,
            durationSeconds: edited.durationSeconds,
            width: edited.width,
            height: edited.height,
          },
        },
      });
      this.realtime.emit(
        'content.updated',
        {
          contentId: input.contentId,
          status,
          autoEditStatus: 'COMPLETED',
        },
        input.businessId,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error en autoedición';
      this.logger.warn(
        `Autoedición falló content=${input.contentId}: ${message}`,
      );
      await this.prisma.generatedContent.update({
        where: { id: input.contentId },
        data: { autoEditStatus: 'FAILED', autoEditError: message },
      });
      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId: input.businessId,
          contentId: input.contentId,
          stage: 'video-edit',
          provider: 'ffmpeg',
          model: 'auto-editor',
          success: false,
          error: message,
          durationMs: Date.now() - started,
        },
      });
      this.realtime.emit(
        'content.updated',
        {
          contentId: input.contentId,
          status,
          autoEditStatus: 'FAILED',
          error: message,
        },
        input.businessId,
      );
      if (input.throwOnError) {
        throw new BadRequestException(message);
      }
    }
  }

  private async removeEditedAssets(contentId: string) {
    const edited = await this.prisma.contentAsset.findMany({
      where: { contentId, role: 'EDITED' },
    });
    for (const asset of edited) {
      if (asset.storagePublicId && this.storage.delete) {
        try {
          await this.storage.delete(
            asset.storagePublicId,
            asset.type === 'VIDEO' ? 'video' : 'image',
          );
        } catch {
          // ignore cleanup errors
        }
      }
    }
    if (edited.length) {
      await this.prisma.contentAsset.deleteMany({
        where: { contentId, role: 'EDITED' },
      });
    }
  }

  private strategyFromStored(content: {
    objective: string;
    topic: string | null;
    headline: string | null;
    hook: string | null;
    caption: string | null;
    cta: string | null;
    hashtags: string[];
    imagePrompt: string | null;
    videoPrompt: string | null;
    visualStyle: string | null;
    strategy: unknown;
  }): ContentStrategy {
    const stored =
      content.strategy &&
      typeof content.strategy === 'object' &&
      !Array.isArray(content.strategy)
        ? (content.strategy as Record<string, unknown>)
        : {};
    const storedEditing =
      stored.editing &&
      typeof stored.editing === 'object' &&
      !Array.isArray(stored.editing)
        ? (stored.editing as VideoEditingPlan)
        : undefined;
    const storedHook =
      typeof stored.hook === 'string' ? stored.hook.trim() : '';
    const storedHashtags = Array.isArray(stored.hashtags)
      ? stored.hashtags.filter((tag): tag is string => typeof tag === 'string')
      : [];

    return {
      topic: content.topic || String(stored.topic || 'contenido'),
      objective: this.parseObjective(content.objective),
      headline: content.headline || String(stored.headline || ''),
      caption: content.caption || String(stored.caption || ''),
      cta: content.cta || String(stored.cta || ''),
      hook: content.hook?.trim() || storedHook || content.headline || undefined,
      hashtags: content.hashtags?.length
        ? content.hashtags
        : normalizeHashtags(storedHashtags),
      imagePrompt:
        content.imagePrompt ||
        String(stored.imagePrompt || 'social marketing visual'),
      videoPrompt:
        content.videoPrompt ||
        (typeof stored.videoPrompt === 'string'
          ? stored.videoPrompt
          : undefined),
      visualStyle: content.visualStyle || String(stored.visualStyle || ''),
      editing: storedEditing,
    };
  }

  private async markGenerationFailed(
    contentId: string,
    businessId: string,
    message: string,
  ) {
    await this.prisma.generatedContent.update({
      where: { id: contentId },
      data: { status: 'FAILED', error: message },
    });
    await this.prisma.contentGenerationExecution.create({
      data: {
        businessId,
        contentId,
        stage: 'failed',
        success: false,
        error: message,
        durationMs: 0,
      },
    });
    this.realtime.emit(
      'content.generation.failed',
      { contentId, error: message },
      businessId,
    );
  }

  async publish(id: string, input?: { channels?: string[] }) {
    const businessId = await this.businesses.getCurrentId();
    const content = await this.prisma.generatedContent.findFirst({
      where: { id, businessId },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        publications: true,
      },
    });
    if (!content) throw new NotFoundException('Contenido no encontrado');
    if (!content.assets.length) {
      throw new BadRequestException(
        'El contenido no tiene media para publicar',
      );
    }
    if (['GENERATING', 'PUBLISHING'].includes(content.status)) {
      throw new BadRequestException('El contenido ya se esta procesando');
    }
    // Permitir reintento si falló la publicación pero hay assets
    if (content.status === 'FAILED' && !content.assets.length) {
      throw new BadRequestException('El contenido falló y no tiene media');
    }

    const channels = this.parseChannels(
      input?.channels?.length ? input.channels : content.channels,
    );
    if (!channels.length) {
      throw new BadRequestException(
        'Seleccioná al menos un canal para publicar',
      );
    }

    await this.prisma.generatedContent.update({
      where: { id },
      data: { status: 'PUBLISHING', error: null },
    });
    this.realtime.emit(
      'content.publishing',
      { contentId: id, channels },
      businessId,
    );

    const caption = this.buildPublishCaption(content);
    const results: Array<{
      channel: ContentChannel;
      status: 'PUBLISHED' | 'FAILED';
      externalId?: string;
      error?: string;
    }> = [];

    for (const channel of channels) {
      const publication = await this.prisma.contentPublication.create({
        data: {
          businessId,
          contentId: id,
          channel,
          status: 'PUBLISHING',
        },
      });

      try {
        const asset = this.pickAssetForChannel(content.assets, channel);
        if (!asset?.storageUrl) {
          throw new Error('No hay asset compatible para este canal');
        }
        const isVideo = (asset.type ?? 'IMAGE').toUpperCase() === 'VIDEO';
        // Texto y logo ya están quemados vía BrandingRenderer (Sharp) antes del upload — no usar overlay Cloudinary para evitar doble
        const storyImageUrl = asset.storageUrl;

        let externalId: string | undefined;
        if (channel === 'WHATSAPP_STATUS') {
          const sent = isVideo
            ? await this.waha.sendVideoStatus({
                businessId,
                videoUrl: asset.storageUrl,
                caption,
                mimetype: 'video/mp4',
              })
            : await this.waha.sendImageStatus({
                businessId,
                imageUrl: asset.storageUrl,
                caption,
                mimetype: 'image/jpeg',
              });
          externalId = sent.externalId;
        } else if (
          channel === 'INSTAGRAM_STORY' ||
          channel === 'INSTAGRAM_FEED' ||
          channel === 'INSTAGRAM_REEL' ||
          channel === 'FACEBOOK_STORY' ||
          channel === 'FACEBOOK_FEED' ||
          channel === 'FACEBOOK_REEL' ||
          channel === 'TIKTOK'
        ) {
          const platform =
            channel === 'TIKTOK'
              ? 'tiktok'
              : channel.startsWith('FACEBOOK')
                ? 'facebook'
                : 'instagram';
          const contentType =
            channel === 'INSTAGRAM_STORY' || channel === 'FACEBOOK_STORY'
              ? 'story'
              : channel === 'INSTAGRAM_REEL' || channel === 'FACEBOOK_REEL'
                ? 'reel'
                : channel === 'TIKTOK'
                  ? 'video'
                  : 'feed';
          const sent = await this.social.publish({
            businessId,
            platform,
            contentType,
            mediaUrl:
              (channel === 'INSTAGRAM_STORY' || channel === 'FACEBOOK_STORY') &&
              !isVideo
                ? storyImageUrl
                : asset.storageUrl,
            mediaKind: isVideo ? 'video' : 'image',
            caption,
          });
          externalId = sent.externalId;
        } else {
          throw new Error(`Canal no soportado: ${channel}`);
        }

        await this.prisma.contentPublication.update({
          where: { id: publication.id },
          data: {
            status: 'PUBLISHED',
            externalId: externalId ?? null,
            error: null,
            publishedAt: new Date(),
          },
        });
        results.push({ channel, status: 'PUBLISHED', externalId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Error al publicar';
        await this.prisma.contentPublication.update({
          where: { id: publication.id },
          data: { status: 'FAILED', error: message },
        });
        results.push({ channel, status: 'FAILED', error: message });
      }
    }

    const publishedCount = results.filter(
      (r) => r.status === 'PUBLISHED',
    ).length;
    const failedCount = results.length - publishedCount;
    const finalStatus: ContentStatus =
      publishedCount === 0
        ? 'FAILED'
        : failedCount === 0
          ? 'PUBLISHED'
          : 'PARTIALLY_PUBLISHED';

    const updated = await this.prisma.generatedContent.update({
      where: { id },
      data: {
        status: finalStatus,
        publishedAt: publishedCount > 0 ? new Date() : content.publishedAt,
        error:
          failedCount > 0
            ? results
                .filter((r) => r.status === 'FAILED')
                .map((r) => `${r.channel}: ${r.error}`)
                .join(' | ')
            : null,
      },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        service: { select: { id: true, name: true } },
        publications: { orderBy: { createdAt: 'desc' } },
      },
    });

    this.realtime.emit(
      'content.published',
      {
        contentId: id,
        status: finalStatus,
        results,
      },
      businessId,
    );
    this.realtime.emit(
      'content.updated',
      { contentId: id, status: finalStatus },
      businessId,
    );

    return updated;
  }

  async updateDraft(
    id: string,
    input: {
      caption?: string;
      headline?: string;
      cta?: string;
      hashtags?: string[];
      status?: string;
    },
  ) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.generatedContent.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Contenido no encontrado');

    const status =
      input.status && ['DRAFT', 'READY'].includes(input.status)
        ? (input.status as ContentStatus)
        : existing.status === 'READY' || existing.status === 'DRAFT'
          ? existing.status
          : 'DRAFT';

    const updated = await this.prisma.generatedContent.update({
      where: { id },
      data: {
        caption: input.caption ?? undefined,
        headline: input.headline ?? undefined,
        cta: input.cta ?? undefined,
        ...(input.hashtags !== undefined
          ? { hashtags: normalizeHashtags(input.hashtags) }
          : {}),
        status,
      },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        service: { select: { id: true, name: true } },
      },
    });

    this.realtime.emit(
      'content.updated',
      { contentId: updated.id, status: updated.status },
      businessId,
    );
    return updated;
  }

  async saveDraft(id: string) {
    return this.updateDraft(id, { status: 'DRAFT' });
  }

  async remove(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.generatedContent.findFirst({
      where: { id, businessId },
      include: { assets: true },
    });
    if (!existing) throw new NotFoundException('Contenido no encontrado');

    for (const asset of existing.assets) {
      if (asset.storagePublicId && this.storage.delete) {
        try {
          await this.storage.delete(
            asset.storagePublicId,
            asset.type === 'VIDEO' ? 'video' : 'image',
          );
        } catch {
          // ignore cleanup errors
        }
      }
    }

    await this.prisma.generatedContent.delete({ where: { id } });
    this.realtime.emit(
      'content.updated',
      { contentId: id, deleted: true },
      businessId,
    );
    return { ok: true };
  }

  async getBranding() {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.brandingConfig.findUnique({ where: { businessId } });
  }

  async upsertBranding(input: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    visualStyle?: string | null;
    commercialTone?: string | null;
    targetAudience?: string | null;
    preferNotes?: string | null;
    avoidNotes?: string | null;
    additionalInstructions?: string | null;
  }) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.brandingConfig.upsert({
      where: { businessId },
      create: { businessId, ...input },
      update: { ...input },
    });
  }

  async getSocialConfig() {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.socialContentConfig.findUnique({
      where: { businessId },
    });
    if (existing) return existing;
    return this.prisma.socialContentConfig.create({
      data: { businessId },
    });
  }

  async upsertSocialConfig(input: {
    defaultChannels?: string[];
    maxGenerationsPerDay?: number;
    maxGenerationsPerMonth?: number;
    preferredObjectives?: string[];
    autoGenerateEnabled?: boolean;
    autoGenerateDaysOfWeek?: number[];
    autoGenerateTime?: string;
    autoGenerateChannels?: string[];
    autoGenerateObjective?: string;
    notifyWhatsAppPhone?: string | null;
    notifyEmail?: string | null;
  }) {
    const businessId = await this.businesses.getCurrentId();
    const days = input.autoGenerateDaysOfWeek
      ? [
          ...new Set(
            input.autoGenerateDaysOfWeek.filter((d) => d >= 1 && d <= 7),
          ),
        ]
      : undefined;
    const channels = input.autoGenerateChannels
      ? this.parseChannels(input.autoGenerateChannels)
      : undefined;
    const objective = input.autoGenerateObjective
      ? this.parseObjective(input.autoGenerateObjective)
      : undefined;
    const time = input.autoGenerateTime?.trim();
    const notifyPhone = this.normalizeNotifyPhone(input.notifyWhatsAppPhone);
    const notifyEmail = this.normalizeNotifyEmail(input.notifyEmail);

    const saved = await this.prisma.socialContentConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        defaultChannels: input.defaultChannels ?? [],
        maxGenerationsPerDay: input.maxGenerationsPerDay ?? 20,
        maxGenerationsPerMonth: input.maxGenerationsPerMonth ?? 200,
        preferredObjectives: input.preferredObjectives ?? [],
        autoGenerateEnabled: input.autoGenerateEnabled ?? false,
        autoGenerateDaysOfWeek: days ?? [1, 2, 3, 4, 5, 6, 7],
        autoGenerateTime: time || '10:00',
        autoGenerateChannels: channels ?? [],
        autoGenerateObjective: objective ?? 'AUTOMATIC',
        notifyWhatsAppPhone: notifyPhone,
        notifyEmail,
      },
      update: {
        ...(input.defaultChannels
          ? { defaultChannels: input.defaultChannels }
          : {}),
        ...(input.maxGenerationsPerDay != null
          ? { maxGenerationsPerDay: input.maxGenerationsPerDay }
          : {}),
        ...(input.maxGenerationsPerMonth != null
          ? { maxGenerationsPerMonth: input.maxGenerationsPerMonth }
          : {}),
        ...(input.preferredObjectives
          ? { preferredObjectives: input.preferredObjectives }
          : {}),
        ...(input.autoGenerateEnabled !== undefined
          ? { autoGenerateEnabled: input.autoGenerateEnabled }
          : {}),
        ...(days !== undefined ? { autoGenerateDaysOfWeek: days } : {}),
        ...(time !== undefined ? { autoGenerateTime: time || '10:00' } : {}),
        ...(channels !== undefined ? { autoGenerateChannels: channels } : {}),
        ...(objective !== undefined
          ? { autoGenerateObjective: objective }
          : {}),
        ...(input.notifyWhatsAppPhone !== undefined
          ? { notifyWhatsAppPhone: notifyPhone }
          : {}),
        ...(input.notifyEmail !== undefined ? { notifyEmail } : {}),
      },
    });

    // Re-registrar / quitar el cron en Redis (BullMQ)
    await this.autoGenerateScheduler.syncBusiness(businessId);
    return saved;
  }

  /** Genera una pieza automática para un business (usado por el scheduler). */
  async runScheduledGeneration(businessId: string) {
    const config = await this.prisma.socialContentConfig.findUnique({
      where: { businessId },
    });
    if (!config?.autoGenerateEnabled) return null;

    try {
      const channels =
        this.parseChannels(config.autoGenerateChannels).length > 0
          ? this.parseChannels(config.autoGenerateChannels)
          : this.parseChannels(config.defaultChannels).length > 0
            ? this.parseChannels(config.defaultChannels)
            : (['INSTAGRAM_STORY', 'INSTAGRAM_FEED'] as ContentChannel[]);

      const content = await this.generate({
        businessId,
        objective: config.autoGenerateObjective || 'AUTOMATIC',
        channels,
        generationMode: 'AUTOMATIC',
        userInstructions:
          'Generá una pieza orgánica acorde a la marca. Variá el enfoque respecto a piezas recientes.',
      });

      await this.prisma.socialContentConfig.update({
        where: { businessId },
        data: { lastAutoGenerateAt: new Date() },
      });

      if (content.status !== 'GENERATING') {
        await this.notify.notifyAutoGeneration({
          businessId,
          contentId: content.id,
          mediaType: content.mediaType,
          headline: content.headline,
          topic: content.topic,
          status: content.status,
        });
      }

      return content;
    } catch (error) {
      await this.notify.notifyAutoGeneration({
        businessId,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Error al generar',
      });
      throw error;
    }
  }

  private buildPublishCaption(content: {
    caption?: string | null;
    headline?: string | null;
    cta?: string | null;
    hashtags?: string[];
  }): string {
    const tags = normalizeHashtags(content.hashtags).join(' ');
    const caption = content.caption?.trim() || '';
    const captionWithTags =
      tags && !/#\w/.test(caption)
        ? [caption, tags].filter(Boolean).join('\n\n')
        : caption;
    return [captionWithTags, content.cta?.trim()]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2200);
  }

  private pickAssetForChannel(
    assets: Array<{
      type?: string;
      role?: string | null;
      format: string;
      storageUrl: string;
      storagePublicId?: string | null;
    }>,
    channel: ContentChannel,
  ) {
    if (!assets.length) return null;
    const videos = assets.filter((a) => (a.type ?? 'IMAGE') === 'VIDEO');
    const images = assets.filter((a) => (a.type ?? 'IMAGE') !== 'VIDEO');
    const preferVideo =
      channel === 'INSTAGRAM_REEL' ||
      channel === 'FACEBOOK_REEL' ||
      channel === 'TIKTOK' ||
      (videos.length > 0 && images.length === 0);
    const editedVideo = videos.find((a) => a.role === 'EDITED');
    if (preferVideo && editedVideo) return editedVideo;
    const pool =
      preferVideo && videos.length ? videos : images.length ? images : assets;

    if (channel === 'INSTAGRAM_FEED' || channel === 'FACEBOOK_FEED') {
      return (
        pool.find((a) => a.format === 'FEED_SQUARE') ||
        pool.find((a) => a.format.startsWith('FEED_')) ||
        pool[0]
      );
    }
    if (
      channel === 'INSTAGRAM_REEL' ||
      channel === 'FACEBOOK_REEL' ||
      channel === 'TIKTOK'
    ) {
      return (
        pool.find((a) => a.format === 'SHORT_VERTICAL') ||
        pool.find((a) => a.format === 'STORY_VERTICAL') ||
        pool[0]
      );
    }
    return (
      pool.find((a) => a.format === 'SHORT_VERTICAL') ||
      pool.find((a) => a.format === 'STORY_VERTICAL') ||
      pool.find((a) => a.format.startsWith('FEED_')) ||
      pool[0]
    );
  }

  private enrichMarketingImagePrompt(input: {
    basePrompt: string;
    headline?: string | null;
    objective: ContentObjective;
    businessName: string;
    hasLogo: boolean;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  }): string {
    const brandMark = input.hasLogo
      ? `The brand logo will be applied programmatically after generation (BrandingRenderer, Sharp). Do NOT render any logo in the image — leave a clean safe margin at the corner (bottom-right). Use brand colors/style only.`
      : `Include the business name "${input.businessName}" as clean, legible professional typography (brand lockup) if it enhances hierarchy — keep it minimal.`;

    const offerBadge =
      input.objective === 'OFFER'
        ? `Add a prominent, clean "OFERTA" / "PROMO" badge or seal (short readable text, high contrast).`
        : input.objective === 'SPECIAL_DATE'
          ? `Add a short occasion badge (readable, not decorative gibberish).`
          : '';

    const headline = input.headline?.trim()
      ? `Short headline text on image (few words only): "${input.headline.trim()}".`
      : 'Leave a clean area for a short headline (few words, high contrast).';

    const colors = [
      input.primaryColor ? `primary ${input.primaryColor}` : null,
      input.secondaryColor ? `secondary ${input.secondaryColor}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const colorHint = colors ? `Prefer brand colors: ${colors}.` : '';

    return [
      input.basePrompt.trim(),
      '',
      'MARKETING COMPOSITION (mandatory):',
      'This must look like a social media marketing creative / flyer, NOT a plain photo.',
      brandMark,
      offerBadge,
      headline,
      colorHint,
      'Clear visual hierarchy: hero visual + brand + message. Safe margins for feed/story.',
      'No illegible text, no lorem ipsum, no fake letters, no long paragraphs on the image.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private cloudinaryRoot() {
    return process.env.CLOUDINARY_FOLDER?.trim() || 'cloud-platform';
  }

  private normalizeReferenceUrls(urls: string[] | undefined): string[] {
    return [
      ...new Set((urls ?? []).map((u) => u.trim()).filter(Boolean)),
    ].slice(0, 4);
  }

  private async loadReferenceImageBuffers(urls: string[]) {
    const loaded: Array<{
      buffer: Buffer;
      mimeType: string;
      filename: string;
    }> = [];

    for (const [index, url] of urls.entries()) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const mimeType = res.headers.get('content-type') || 'image/png';
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length) continue;
        loaded.push({
          buffer,
          mimeType: mimeType.split(';')[0] || 'image/png',
          filename: `reference-${index + 1}.png`,
        });
      } catch {
        // Si falla una ref, seguimos con las demás / sin refs
      }
    }

    return loaded;
  }

  private parseObjective(value: string): ContentObjective {
    const upper = value.trim().toUpperCase();
    if (!OBJECTIVES.has(upper)) {
      throw new BadRequestException('Objetivo inválido');
    }
    return upper as ContentObjective;
  }

  private parseContentStyle(value?: string | null): ContentStyle {
    if (!value?.trim()) return 'AUTO';
    const upper = value.trim().toUpperCase();
    if (!CONTENT_STYLES.has(upper)) {
      throw new BadRequestException('Tipo de contenido inválido');
    }
    return upper as ContentStyle;
  }

  private contentStyleFromStrategy(strategy: unknown): ContentStyle {
    if (!strategy || typeof strategy !== 'object') return 'AUTO';
    const record = strategy as Record<string, unknown>;
    const requested = record.contentStyleRequest;
    if (typeof requested === 'string') {
      try {
        return this.parseContentStyle(requested);
      } catch {
        return 'AUTO';
      }
    }
    const detected = record.contentStyle;
    if (
      detected === 'EDUCATIONAL' ||
      detected === 'COMEDY' ||
      detected === 'SALES'
    ) {
      return detected;
    }
    return 'AUTO';
  }

  private parseChannels(values: string[]): ContentChannel[] {
    const unique = [...new Set(values.map((v) => v.trim().toUpperCase()))];
    for (const value of unique) {
      if (!CHANNELS.has(value)) {
        throw new BadRequestException(`Canal inválido: ${value}`);
      }
    }
    return unique as ContentChannel[];
  }

  private parseMediaType(value?: string | null): ContentMediaType {
    const upper = (value ?? 'IMAGE').trim().toUpperCase();
    if (upper === 'VIDEO') return 'VIDEO';
    return 'IMAGE';
  }

  private normalizeNotifyPhone(value?: string | null): string | null {
    if (value === undefined) return null;
    if (value === null) return null;
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length < 8 || digits.length > 15) {
      throw new BadRequestException(
        'El número de WhatsApp debe tener entre 8 y 15 dígitos, con código de país (ej. 54911...)',
      );
    }
    return digits;
  }

  private normalizeNotifyEmail(value?: string | null): string | null {
    if (value === undefined) return null;
    if (value === null) return null;
    const email = value.trim().toLowerCase();
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Email de aviso inválido');
    }
    return email;
  }

  private resolveFormats(channels: ContentChannel[]): ContentAssetFormat[] {
    const needsVertical = channels.some(
      (c) =>
        c === 'WHATSAPP_STATUS' ||
        c === 'INSTAGRAM_STORY' ||
        c === 'INSTAGRAM_REEL' ||
        c === 'FACEBOOK_STORY' ||
        c === 'FACEBOOK_REEL' ||
        c === 'TIKTOK',
    );
    const needsFeed =
      channels.includes('INSTAGRAM_FEED') ||
      channels.includes('FACEBOOK_FEED');
    const formats: ContentAssetFormat[] = [];
    if (needsVertical) formats.push('STORY_VERTICAL');
    if (needsFeed) formats.push('FEED_SQUARE');
    if (!formats.length) formats.push('FEED_SQUARE');
    return formats;
  }

  private sizeForFormat(format: ContentAssetFormat): string {
    if (format === 'STORY_VERTICAL') return '1024x1536';
    if (format === 'FEED_LANDSCAPE') return '1536x1024';
    return '1024x1024';
  }

  private aspectForFormat(format: ContentAssetFormat): string {
    if (format === 'STORY_VERTICAL' || format === 'SHORT_VERTICAL')
      return '9:16';
    if (format === 'FEED_LANDSCAPE') return '16:9';
    if (format === 'FEED_PORTRAIT') return '4:5';
    return '1:1';
  }

  private async assertGenerationLimits(businessId: string) {
    const config =
      (await this.prisma.socialContentConfig.findUnique({
        where: { businessId },
      })) ??
      (await this.prisma.socialContentConfig.create({
        data: { businessId },
      }));

    const zone = await this.businessTimezone(businessId);
    const now = DateTime.now().setZone(zone);
    const dayStart = now.startOf('day').toUTC().toJSDate();
    const monthStart = now.startOf('month').toUTC().toJSDate();

    const [dayCount, monthCount] = await Promise.all([
      this.prisma.contentGenerationExecution.count({
        where: {
          businessId,
          stage: { in: ['image', 'video'] },
          success: true,
          createdAt: { gte: dayStart },
        },
      }),
      this.prisma.contentGenerationExecution.count({
        where: {
          businessId,
          stage: { in: ['image', 'video'] },
          success: true,
          createdAt: { gte: monthStart },
        },
      }),
    ]);

    if (dayCount >= config.maxGenerationsPerDay) {
      throw new BadRequestException(
        `Límite diario de generaciones alcanzado (${config.maxGenerationsPerDay})`,
      );
    }
    if (monthCount >= config.maxGenerationsPerMonth) {
      throw new BadRequestException(
        `Límite mensual de generaciones alcanzado (${config.maxGenerationsPerMonth})`,
      );
    }
  }

  private async businessTimezone(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    return business?.timezone || 'America/Argentina/Buenos_Aires';
  }
}
