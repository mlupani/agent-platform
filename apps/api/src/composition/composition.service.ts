import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../content/storage/storage.provider';
import { FFMPEG_RUNNER } from '../content/video-editor/ffmpeg.runner';
import type { FfmpegRunner } from '../content/video-editor/video-editor.types';
import { probeVideoFile, assertPlayableMp4 } from '../content/video-editor/video-probe';

@Injectable()
export class CompositionService {
  private readonly logger = new Logger(CompositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly config: ConfigService,
    @Inject(FFMPEG_RUNNER) private readonly runner: FfmpegRunner,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private cloudinaryRoot() {
    return process.env.CLOUDINARY_FOLDER?.trim() || 'cloud-platform';
  }

  async replaceAudio(input: { contentId: string; audioAssetId: string }) {
    const businessId = await this.businesses.getCurrentId();
    const content = await this.prisma.generatedContent.findFirst({
      where: { id: input.contentId, businessId },
      include: { assets: { orderBy: { createdAt: 'desc' } } },
    });
    if (!content) throw new BadRequestException('Contenido no encontrado');
    if (content.mediaType !== 'VIDEO') throw new BadRequestException('Solo videos');

    // Find original video asset (preserve original)
    const original = content.assets.find((a) => a.role === 'ORIGINAL' && a.type === 'VIDEO')
      ?? content.assets.find((a) => a.type === 'VIDEO')
      ?? null;
    if (!original?.storageUrl) throw new BadRequestException('Video original no encontrado');

    const audioAsset = await this.prisma.audioAsset.findFirst({
      where: { id: input.audioAssetId, businessId, contentId: content.id },
    });
    if (!audioAsset) throw new BadRequestException('Audio no encontrado');
    if (audioAsset.status === 'FAILED') throw new BadRequestException('Audio fallido, regenerá');
    if (!audioAsset.storageUrl) throw new BadRequestException('Audio sin URL, regenerá');

    this.logger.log(`[COMPOSITION] Video ${original.id} + Audio ${audioAsset.id} -> compose`);
    this.logger.log(`[COMPOSITION] Voice: ${audioAsset.voiceId} text: "${(audioAsset.text ?? '').slice(0, 80)}"`);

    const workDir = await mkdtemp(join(tmpdir(), 'compose-'));
    try {
      const videoPath = join(workDir, 'input.mp4');
      const audioPath = join(workDir, 'input.mp3');
      const outputPath = join(workDir, 'output.mp4');

      // Download video
      const videoRes = await fetch(original.storageUrl);
      if (!videoRes.ok) throw new BadRequestException(`No se pudo descargar video original (${videoRes.status})`);
      const videoBuf = Buffer.from(await videoRes.arrayBuffer());
      await writeFile(videoPath, videoBuf);

      // Download audio
      const audioRes = await fetch(audioAsset.storageUrl);
      if (!audioRes.ok) throw new BadRequestException(`No se pudo descargar audio (${audioRes.status})`);
      const audioBuf = Buffer.from(await audioRes.arrayBuffer());
      await writeFile(audioPath, audioBuf);

      // Probe durations via ffprobe
      const videoProbe = await probeVideoFile(this.runner, videoPath, 30_000);
      assertPlayableMp4(videoProbe);
      const videoDuration = videoProbe.durationSeconds;
      this.logger.log(`[COMPOSITION] Video duration: ${videoDuration}s`);

      // Probe audio duration — reuse ffprobe but audio file has only audio stream, probeVideoFile expects video stream -> need generic probe
      // We'll use probeVideoFile but handle audio-only: if no video stream, probe will throw. So probe audio via ffprobe directly
      let audioDuration: number | null = null;
      try {
        const audioProbe = await this.probeAudioDuration(audioPath);
        audioDuration = audioProbe;
        this.logger.log(`[COMPOSITION] Audio duration: ${audioDuration}s`);
      } catch (e) {
        this.logger.warn(`[COMPOSITION] No se pudo medir duración audio: ${e instanceof Error ? e.message : 'unknown'}`);
        // Fallback to AudioAsset duration if present
        audioDuration = audioAsset.durationSeconds ?? null;
      }

      if (audioDuration !== null && videoDuration !== null) {
        // If audio significantly longer than video (+1s tolerance)
        if (audioDuration > videoDuration + 0.7) {
          const msg = `El audio dura ${audioDuration.toFixed(1)}s y el video ${videoDuration.toFixed(1)}s. El audio es más largo que el video — acortá el texto o generá un video más largo (10s/15s). No se cortó la narración.`;
          this.logger.warn(`[COMPOSITION] Audio longer than video: ${msg}`);
          throw new BadRequestException(msg);
        }
        // If audio much shorter, we will keep video length (pad silence implicitly)
        this.logger.log(`[COMPOSITION] Duration check OK (audio ${audioDuration?.toFixed(1)}s <= video ${videoDuration.toFixed(1)}s)`);
      }

      // Compose: replace audio, keep video (-c:v copy) only encode audio to aac
      // Use -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -shortest? No -shortest would cut video if audio shorter. So no -shortest, let video be master.
      // Add -t videoDuration to ensure output = video duration
      const durationArg = videoDuration ? ['-t', String(videoDuration)] : [];
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        videoPath,
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        ...durationArg,
        outputPath,
      ];

      this.logger.log(`[COMPOSITION] FFmpeg compose ${videoDuration}s video + audio`);
      await this.runner.run(args, 120_000);

      try {
        await access(outputPath);
      } catch {
        throw new BadRequestException('FFmpeg no generó el video compuesto');
      }

      const outProbe = await probeVideoFile(this.runner, outputPath, 30_000);
      assertPlayableMp4(outProbe);

      const outBuffer = await readFile(outputPath);
      if (!outBuffer.length) throw new BadRequestException('Video compuesto vacío');

      // Upload composed video
      const uploaded = await this.storage.upload({
        buffer: outBuffer,
        mimeType: 'video/mp4',
        folder: `${this.cloudinaryRoot()}/${businessId}/content`,
        publicId: `${content.id}-composed-${Date.now()}`,
        resourceType: 'video',
      });

      // Create new ContentAsset with role COMPOSED (preserve ORIGINAL)
      const composedAsset = await this.prisma.contentAsset.create({
        data: {
          contentId: content.id,
          type: 'VIDEO',
          role: 'COMPOSED',
          format: 'SHORT_VERTICAL',
          aspectRatio: '9:16',
          width: outProbe.width,
          height: outProbe.height,
          storageUrl: uploaded.url,
          storagePublicId: uploaded.publicId,
          provider: 'ffmpeg',
          model: 'composition',
          generationPrompt: audioAsset.text,
          generationCost: 0,
        },
      });

      await this.prisma.contentGenerationExecution.create({
        data: {
          businessId,
          contentId: content.id,
          stage: 'composition',
          provider: 'ffmpeg',
          model: 'composition',
          success: true,
          durationMs: 0,
          metadata: {
            audioAssetId: audioAsset.id,
            voiceId: audioAsset.voiceId,
            videoAssetId: original.id,
            audioDuration,
            videoDuration,
            durationSeconds: outProbe.durationSeconds,
          },
        },
      });

      this.logger.log(`[COMPOSITION] Completed composed asset ${composedAsset.id}`);
      return { composedAsset, audioAsset, originalAsset: original };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async probeAudioDuration(filePath: string): Promise<number> {
    // Use ffprobe to get duration for audio file
    const tmpRunner = this.runner;
    // Reuse probeVideoFile but handle audio-only by directly calling ffprobe via runner
    // We'll manually run ffprobe
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ];
    // Use runner's ffprobe path via internal — we can call probeVideoFile for video, but for audio we need custom
    // Fallback: use ffprobe directly via execFile
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    // Get ffprobe path from runner if available
    const ffprobePath = (tmpRunner as unknown as { ffprobePath?: () => string })?.ffprobePath?.() ?? 'ffprobe';
    try {
      const { stdout } = await execFileAsync(ffprobePath, args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
      const dur = parsed.format?.duration ? Number(parsed.format.duration) : NaN;
      if (Number.isFinite(dur) && dur > 0.1) return dur;
      throw new Error('Duración no detectada');
    } catch (e) {
      // fallback: try probeVideoFile which may throw but we catch
      throw e;
    }
  }

  async listComposedForContent(contentId: string) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.contentAsset.findMany({
      where: { contentId, type: 'VIDEO', role: 'COMPOSED' },
      orderBy: { createdAt: 'desc' },
    });
  }
}
