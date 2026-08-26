import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVideoEditorSettings } from './video-editor.config';
import { VideoEditError } from './video-editor.errors';
import { FFMPEG_RUNNER } from './ffmpeg.runner';
import { buildFilterGraph, planOperations } from './filter-graph.builder';
import { CTA_HAND_EMOJI, CTA_HAND_FALLBACK } from './overlay-style';
import {
  defaultCtaWindow,
  defaultHookWindow,
  resolveOverlayRange,
} from './text-overlay';
import {
  assertDurationClose,
  assertPlayableMp4,
  probeVideoFile,
} from './video-probe';
import type {
  AutoEditInput,
  AutoEditResult,
  FfmpegRunner,
  VideoEditOperation,
} from './video-editor.types';

@Injectable()
export class VideoEditorService {
  private readonly logger = new Logger(VideoEditorService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(FFMPEG_RUNNER) private readonly runner: FfmpegRunner,
  ) {}

  /**
   * Postproducción automática: 9:16 + overlays de hook/CTA/logo vía FFmpeg.
   * Si no hay nada que hacer, devuelve `skipped: true` y el caller usa el original.
   */
  async edit(input: AutoEditInput): Promise<AutoEditResult> {
    const settings = loadVideoEditorSettings(this.config);
    if (!settings.enabled) {
      return {
        skipped: true,
        mimeType: input.mimeType || 'video/mp4',
        width: 0,
        height: 0,
        durationSeconds: input.expectedDurationSeconds ?? 0,
        operations: [],
      };
    }

    const workDir = await mkdtemp(
      join(settings.tmpDir || tmpdir(), 'video-edit-'),
    );

    try {
      const inputPath = join(workDir, 'input.mp4');
      await writeFile(inputPath, input.videoBuffer);

      const probe = await probeVideoFile(
        this.runner,
        inputPath,
        Math.min(30_000, settings.timeoutMs),
      );
      assertPlayableMp4(probe);
      if (input.expectedDurationSeconds) {
        const tolerance = Math.max(
          settings.durationToleranceSeconds,
          input.expectedDurationSeconds * 0.45,
        );
        assertDurationClose(
          probe.durationSeconds,
          input.expectedDurationSeconds,
          tolerance,
        );
      }

      const logoPath = await this.maybeDownloadLogo(
        input.instructions.addLogo ? input.branding.logoUrl : null,
        workDir,
      );

      const duration = probe.durationSeconds;
      const hookRange = resolveOverlayRange(
        input.instructions.hookStart,
        input.instructions.hookEnd,
        duration,
        defaultHookWindow(duration),
        0.4,
      );
      const ctaRange = resolveOverlayRange(
        input.instructions.ctaStart,
        input.instructions.ctaEnd,
        duration,
        defaultCtaWindow(duration),
        0.32,
      );

      const operations = planOperations({
        probe,
        settings,
        addHook: false,
        hookText: input.instructions.hookText,
        hookStart: hookRange.start,
        hookEnd: hookRange.end,
        hookPosition: input.instructions.hookPosition,
        hookFontSize: input.instructions.hookFontSize,
        addCta:
          Boolean(settings.fontFile) &&
          input.instructions.addCta &&
          Boolean(ctaRange),
        ctaText: input.instructions.ctaText,
        ctaStart: ctaRange.start,
        ctaEnd: ctaRange.end,
        ctaPosition: input.instructions.ctaPosition,
        ctaFontSize: input.instructions.ctaFontSize,
        addLogo: Boolean(logoPath) && input.instructions.addLogo,
        logoFilePath: logoPath,
        logoPosition: input.instructions.logoPosition,
        logoWidth: input.instructions.logoWidth,
        logoOpacity: input.instructions.logoOpacity,
        forceMotion: input.instructions.forceMotion,
      });

      if (!operations.length) {
        return {
          skipped: true,
          mimeType: 'video/mp4',
          width: probe.width,
          height: probe.height,
          durationSeconds: probe.durationSeconds,
          operations: [],
        };
      }

      const textFiles = await this.writeTextFiles(workDir, operations, settings);
      const graph = buildFilterGraph({
        probe,
        operations,
        settings,
        fontFile: settings.fontFile,
        hookTextFile: textFiles.hook,
        ctaTextFile: textFiles.cta,
        ctaHandFile: textFiles.hand,
        accentColor: input.branding.primaryColor,
      });

      const outputPath = join(workDir, 'output.mp4');
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        ...(graph.needsLogoInput && logoPath ? ['-i', logoPath] : []),
        '-filter_complex',
        graph.filterComplex,
        '-map',
        `[${graph.outputLabel}]`,
        ...(probe.hasAudio
          ? ['-map', '0:a', '-c:a', 'aac', '-b:a', '128k']
          : ['-an']),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath,
      ];

      await this.runner.run(args, settings.timeoutMs);

      try {
        await access(outputPath);
      } catch {
        throw new VideoEditError('FFmpeg no generó el archivo de salida');
      }

      const outProbe = await probeVideoFile(
        this.runner,
        outputPath,
        Math.min(30_000, settings.timeoutMs),
      );
      assertPlayableMp4(outProbe);
      assertDurationClose(
        outProbe.durationSeconds,
        probe.durationSeconds,
        settings.durationToleranceSeconds,
      );

      const buffer = await readFile(outputPath);
      if (!buffer.length) {
        throw new VideoEditError('El video final está vacío');
      }

      return {
        skipped: false,
        buffer,
        mimeType: 'video/mp4',
        width: outProbe.width,
        height: outProbe.height,
        durationSeconds: outProbe.durationSeconds,
        operations: graph.operations,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch((error) => {
        this.logger.warn(
          `No se pudo limpiar temporales ${workDir}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
    }
  }

  private async writeTextFiles(
    workDir: string,
    operations: VideoEditOperation[],
    settings: { emojiFontFile: string | null },
  ): Promise<{ hook: string | null; cta: string | null; hand: string | null }> {
    let hook: string | null = null;
    let cta: string | null = null;
    let hand: string | null = null;
    for (const op of operations) {
      if (op.type !== 'text') continue;
      const filePath = join(workDir, `${op.id}.txt`);
      await writeFile(filePath, op.text, 'utf8');
      if (op.id === 'hook') hook = filePath;
      if (op.id === 'cta') cta = filePath;
    }
    if (cta) {
      const handPath = join(workDir, 'cta-hand.txt');
      await writeFile(
        handPath,
        settings.emojiFontFile ? CTA_HAND_EMOJI : CTA_HAND_FALLBACK,
        'utf8',
      );
      hand = handPath;
    }
    return { hook, cta, hand };
  }

  private async maybeDownloadLogo(
    logoUrl: string | null | undefined,
    workDir: string,
  ): Promise<string | null> {
    const url = logoUrl?.trim();
    if (!url) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`No se pudo descargar el logo (${response.status})`);
        return null;
      }
      const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) return null;
      const filePath = join(workDir, `logo.${ext}`);
      await writeFile(filePath, buffer);
      return filePath;
    } catch (error) {
      this.logger.warn(
        `Logo no disponible para overlay: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
  }
}
