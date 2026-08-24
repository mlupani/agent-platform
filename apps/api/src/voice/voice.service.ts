import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { ElevenLabsProvider } from './elevenlabs.provider';
import type { VoiceInfo } from './voice.types';
import { STORAGE_PROVIDER, type StorageProvider } from '../content/storage/storage.provider';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly elevenLabs: ElevenLabsProvider,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private cloudinaryRoot() {
    return process.env.CLOUDINARY_FOLDER?.trim() || 'cloud-platform';
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.elevenLabs.isConfigured()) {
      this.logger.warn('listVoices: ELEVENLABS_API_KEY no configurada — retornando vacío');
      return [];
    }
    try {
      return await this.elevenLabs.listVoices();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error al listar voces';
      throw new BadRequestException(msg);
    }
  }

  async preview(input: { text: string; voiceId: string }) {
    const text = input.text?.trim();
    if (!text) throw new BadRequestException('Texto requerido para preview');
    if (!input.voiceId?.trim()) throw new BadRequestException('voiceId requerido');
    try {
      const audio = await this.elevenLabs.preview({ text, voiceId: input.voiceId.trim() });
      return audio;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error al generar preview';
      throw new BadRequestException(msg);
    }
  }

  async generateForContent(input: {
    contentId: string;
    text: string;
    voiceId: string;
    voiceName?: string;
    model?: string;
  }) {
    const businessId = await this.businesses.getCurrentId();
    const content = await this.prisma.generatedContent.findFirst({
      where: { id: input.contentId, businessId },
    });
    if (!content) throw new BadRequestException('Contenido no encontrado');
    if (content.mediaType !== 'VIDEO') {
      throw new BadRequestException('Solo videos tienen audio');
    }
    const text = input.text?.trim();
    if (!text) throw new BadRequestException('Texto requerido');
    if (text.length > 5000) throw new BadRequestException('Texto demasiado largo (máx 5000)');
    const voiceId = input.voiceId?.trim();
    if (!voiceId) throw new BadRequestException('voiceId requerido');

    // Create pending AudioAsset
    const audioAsset = await this.prisma.audioAsset.create({
      data: {
        contentId: content.id,
        businessId,
        provider: 'elevenlabs',
        voiceId,
        voiceName: input.voiceName?.trim() || null,
        text,
        model: input.model?.trim() || this.config.get<string>('ELEVENLABS_MODEL') || 'eleven_multilingual_v2',
        status: 'PROCESSING',
      },
    });

    try {
      const generated = await this.elevenLabs.generate({
        text,
        voiceId,
        model: audioAsset.model ?? undefined,
      });

      // Upload audio buffer to Cloudinary (resource_type video for audio)
      const folder = `${this.cloudinaryRoot()}/${businessId}/audio`;
      const uploaded = await this.storage.upload({
        buffer: generated.buffer,
        mimeType: generated.mimeType,
        folder,
        publicId: `${content.id}-elevenlabs-${Date.now()}`,
        resourceType: 'video',
      });

      this.logger.log(`[VOICE] Audio uploaded ${uploaded.url} (${uploaded.publicId})`);

      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId,
          contentId: content.id,
          stage: 'voice',
          provider: 'elevenlabs',
          model: generated.model,
          success: true,
          durationMs: 0,
          metadata: {
            voiceId,
            voiceName: input.voiceName,
            text: text.slice(0, 500),
            durationSeconds: generated.durationSeconds,
            storagePublicId: uploaded.publicId,
          },
        },
      });

      await this.prisma.audioAsset.update({
        where: { id: audioAsset.id },
        data: {
          storageUrl: uploaded.url,
          storagePublicId: uploaded.publicId,
          durationSeconds: generated.durationSeconds ?? null,
          status: 'COMPLETED',
          error: null,
        },
      });

      const updated = await this.prisma.audioAsset.findUniqueOrThrow({
        where: { id: audioAsset.id },
      });

      return { asset: updated, buffer: generated.buffer, mimeType: generated.mimeType, model: generated.model };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error al generar audio';
      await this.prisma.audioAsset.update({
        where: { id: audioAsset.id },
        data: { status: 'FAILED', error: msg },
      });
      this.logger.warn(`generateForContent ${input.contentId} failed: ${msg}`);
      throw new BadRequestException(msg);
    }
  }

  async listForContent(contentId: string) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.audioAsset.findMany({
      where: { contentId, businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAudioAsset(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const asset = await this.prisma.audioAsset.findFirst({
      where: { id, businessId },
    });
    if (!asset) throw new BadRequestException('Audio no encontrado');
    return asset;
  }
}
