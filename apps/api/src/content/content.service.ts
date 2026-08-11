import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { InstagramService } from '../instagram/instagram.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { WahaWhatsAppProvider } from '../whatsapp/providers/waha.whatsapp-provider';
import { ContentAgentService } from './content-agent.service';
import { ContentAutoGenerateScheduler } from './content-auto-generate.scheduler';
import {
  IMAGE_GENERATION_PROVIDER,
  type ImageGenerationProvider,
} from './image/image-generation.provider';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './storage/storage.provider';
import type {
  ContentAssetFormat,
  ContentChannel,
  ContentObjective,
  ContentStatus,
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

const CHANNELS = new Set([
  'WHATSAPP_STATUS',
  'INSTAGRAM_STORY',
  'INSTAGRAM_FEED',
]);

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly contentAgent: ContentAgentService,
    private readonly realtime: RealtimeEventsService,
    private readonly waha: WahaWhatsAppProvider,
    private readonly instagram: InstagramService,
    private readonly autoGenerateScheduler: ContentAutoGenerateScheduler,
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

    const [costAgg, imageGenerationsThisMonth] = await Promise.all([
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

  async generate(input: {
    objective: string;
    channels: string[];
    userInstructions?: string;
    serviceId?: string;
    contentId?: string;
    referenceImageUrls?: string[];
    businessId?: string;
    generationMode?: 'MANUAL' | 'AUTOMATIC';
  }) {
    const businessId =
      input.businessId ?? (await this.businesses.getCurrentId());
    const generationMode = input.generationMode ?? 'MANUAL';
    const objective = this.parseObjective(input.objective);
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
          error: null,
        },
      });
    }

    this.realtime.emit(
      'content.generation.started',
      { contentId: content.id },
      businessId,
    );

    try {
      const strategyResult = await this.contentAgent.buildStrategy({
        businessId,
        objective,
        channels,
        userInstructions: input.userInstructions,
        serviceId: input.serviceId,
        referenceImageUrls,
      });

      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId,
          contentId: content.id,
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

      const referenceImages = await this.loadReferenceImageBuffers(
        referenceImageUrls,
      );

      const formats = this.resolveFormats(channels);
      const assets = [];

      for (const format of formats) {
        const size = this.sizeForFormat(format);
        const image = await this.images.generate({
          prompt: strategyResult.strategy.imagePrompt,
          size,
          quality: 'medium',
          referenceImages:
            referenceImages.length > 0 ? referenceImages : undefined,
        });

        const uploaded = await this.storage.upload({
          buffer: image.buffer,
          mimeType: image.mimeType,
          folder: `${this.cloudinaryRoot()}/${businessId}/content`,
          publicId: `${content.id}-${format}-${Date.now()}`,
        });
        const asset = await this.prisma.contentAsset.create({
          data: {
            contentId: content.id,
            type: 'IMAGE',
            format,
            aspectRatio: this.aspectForFormat(format),
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
        assets.push(asset);

        await this.prisma.contentGenerationExecution.create({
          data: {
            businessId,
            contentId: content.id,
            stage: 'image',
            provider: image.provider,
            model: image.model,
            success: true,
            inputTokens: image.inputTokens,
            outputTokens: image.outputTokens,
            estimatedCost: image.estimatedCost,
            durationMs: image.durationMs,
            metadata: { format, size },
          },
        });
      }

      const updated = await this.prisma.generatedContent.update({
        where: { id: content.id },
        data: {
          status: 'READY',
          topic: strategyResult.strategy.topic,
          headline: strategyResult.strategy.headline,
          caption: strategyResult.strategy.caption,
          cta: strategyResult.strategy.cta,
          imagePrompt: strategyResult.strategy.imagePrompt,
          visualStyle: strategyResult.strategy.visualStyle,
          strategy: strategyResult.strategy as object,
          serviceId:
            strategyResult.strategy.serviceId || input.serviceId || null,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al generar';
      const failed = await this.prisma.generatedContent.update({
        where: { id: content.id },
        data: { status: 'FAILED', error: message },
        include: {
          assets: true,
          service: { select: { id: true, name: true } },
        },
      });
      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId,
          contentId: content.id,
          stage: 'failed',
          success: false,
          error: message,
          durationMs: 0,
        },
      });
      this.realtime.emit(
        'content.generation.failed',
        { contentId: content.id, error: message },
        businessId,
      );
      throw new BadRequestException(message);
    }
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
      throw new BadRequestException('El contenido no tiene imagenes para publicar');
    }
    if (['GENERATING', 'PUBLISHING'].includes(content.status)) {
      throw new BadRequestException('El contenido ya se esta procesando');
    }
    // Permitir reintento si falló la publicación pero hay assets
    if (content.status === 'FAILED' && !content.assets.length) {
      throw new BadRequestException('El contenido falló y no tiene imagenes');
    }

    const channels = this.parseChannels(
      input?.channels?.length ? input.channels : content.channels,
    );
    if (!channels.length) {
      throw new BadRequestException('Seleccioná al menos un canal para publicar');
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

        // Instagram Story no muestra caption como texto visible → overlay en la imagen.
        // WhatsApp Status sí usa caption nativo → imagen original.
        const storyImageUrl =
          channel === 'INSTAGRAM_STORY'
            ? (this.storage.buildTextOverlayUrl?.({
                publicId: asset.storagePublicId,
                fallbackUrl: asset.storageUrl,
                headline: content.headline,
                caption: content.caption,
              }) ?? asset.storageUrl)
            : asset.storageUrl;

        let externalId: string | undefined;
        if (channel === 'WHATSAPP_STATUS') {
          const sent = await this.waha.sendImageStatus({
            businessId,
            imageUrl: asset.storageUrl,
            caption,
            mimetype: 'image/jpeg',
          });
          externalId = sent.externalId;
        } else if (channel === 'INSTAGRAM_STORY') {
          const sent = await this.instagram.uploadStoryByUrl({
            businessId,
            imageUrl: storyImageUrl,
            caption,
          });
          externalId = sent.externalId;
        } else if (channel === 'INSTAGRAM_FEED') {
          const sent = await this.instagram.uploadFeedPhotoByUrl({
            businessId,
            imageUrl: asset.storageUrl,
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

    const publishedCount = results.filter((r) => r.status === 'PUBLISHED').length;
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
    input: { caption?: string; headline?: string; cta?: string; status?: string },
  ) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.generatedContent.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Contenido no encontrado');

    const status =
      input.status &&
      ['DRAFT', 'READY'].includes(input.status)
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
          await this.storage.delete(asset.storagePublicId);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    await this.prisma.generatedContent.delete({ where: { id } });
    this.realtime.emit('content.updated', { contentId: id, deleted: true }, businessId);
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
  }) {
    const businessId = await this.businesses.getCurrentId();
    const days = input.autoGenerateDaysOfWeek
      ? [...new Set(input.autoGenerateDaysOfWeek.filter((d) => d >= 1 && d <= 7))]
      : undefined;
    const channels = input.autoGenerateChannels
      ? this.parseChannels(input.autoGenerateChannels)
      : undefined;
    const objective = input.autoGenerateObjective
      ? this.parseObjective(input.autoGenerateObjective)
      : undefined;
    const time = input.autoGenerateTime?.trim();

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

    return content;
  }

  private buildPublishCaption(content: {
    caption?: string | null;
    headline?: string | null;
    cta?: string | null;
  }): string {
    return [content.caption?.trim(), content.cta?.trim()]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2200);
  }

  private pickAssetForChannel(
    assets: Array<{
      format: string;
      storageUrl: string;
      storagePublicId?: string | null;
    }>,
    channel: ContentChannel,
  ) {
    if (!assets.length) return null;
    if (channel === 'INSTAGRAM_FEED') {
      return (
        assets.find((a) => a.format === 'FEED_SQUARE') ||
        assets.find((a) => a.format.startsWith('FEED_')) ||
        assets[0]
      );
    }
    // Status / Story → vertical preferido
    return (
      assets.find((a) => a.format === 'STORY_VERTICAL') ||
      assets.find((a) => a.format.startsWith('FEED_')) ||
      assets[0]
    );
  }

  private cloudinaryRoot() {
    return process.env.CLOUDINARY_FOLDER?.trim() || 'cloud-platform';
  }

  private normalizeReferenceUrls(urls: string[] | undefined): string[] {
    return [...new Set((urls ?? []).map((u) => u.trim()).filter(Boolean))].slice(
      0,
      4,
    );
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

  private parseChannels(values: string[]): ContentChannel[] {
    const unique = [...new Set(values.map((v) => v.trim().toUpperCase()))];
    for (const value of unique) {
      if (!CHANNELS.has(value)) {
        throw new BadRequestException(`Canal inválido: ${value}`);
      }
    }
    return unique as ContentChannel[];
  }

  private resolveFormats(channels: ContentChannel[]): ContentAssetFormat[] {
    const needsVertical = channels.some(
      (c) => c === 'WHATSAPP_STATUS' || c === 'INSTAGRAM_STORY',
    );
    const needsFeed = channels.includes('INSTAGRAM_FEED');
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
    if (format === 'STORY_VERTICAL') return '9:16';
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
          stage: 'image',
          success: true,
          createdAt: { gte: dayStart },
        },
      }),
      this.prisma.contentGenerationExecution.count({
        where: {
          businessId,
          stage: 'image',
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
