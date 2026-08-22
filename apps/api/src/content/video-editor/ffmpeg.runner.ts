import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadVideoEditorSettings } from './video-editor.config';
import { VideoEditError, VideoEditUnavailableError } from './video-editor.errors';
import type { FfmpegRunResult, FfmpegRunner } from './video-editor.types';

const execFileAsync = promisify(execFile);

function isMissingBinary(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException;
  return err?.code === 'ENOENT';
}

@Injectable()
export class FfmpegProcessRunner implements FfmpegRunner {
  constructor(private readonly config: ConfigService) {}

  ffmpegPath(): string {
    return loadVideoEditorSettings(this.config).ffmpegPath;
  }

  ffprobePath(): string {
    return loadVideoEditorSettings(this.config).ffprobePath;
  }

  run(args: string[], timeoutMs: number): Promise<FfmpegRunResult> {
    return this.exec(this.ffmpegPath(), args, timeoutMs);
  }

  probe(args: string[], timeoutMs: number): Promise<FfmpegRunResult> {
    return this.exec(this.ffprobePath(), args, timeoutMs);
  }

  private async exec(
    binary: string,
    args: string[],
    timeoutMs: number,
  ): Promise<FfmpegRunResult> {
    try {
      const { stdout, stderr } = await execFileAsync(binary, args, {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' };
    } catch (error) {
      if (isMissingBinary(error)) {
        throw new VideoEditUnavailableError(
          `No se encontró ${binary}. Instalalo en el servidor o definí VIDEO_EDITOR_FFMPEG_PATH / VIDEO_EDITOR_FFPROBE_PATH.`,
        );
      }
      const err = error as {
        killed?: boolean;
        signal?: string;
        stderr?: string | Buffer;
        stdout?: string | Buffer;
        message?: string;
      };
      const stderr = err.stderr?.toString() ?? '';
      const stdout = err.stdout?.toString() ?? '';
      if (err.killed || err.signal === 'SIGTERM') {
        throw new VideoEditError(
          `FFmpeg superó el timeout (${Math.round(timeoutMs / 1000)}s)`,
          'VIDEO_EDIT_TIMEOUT',
        );
      }
      throw new VideoEditError(
        stderr.trim() || err.message || 'FFmpeg falló',
        'FFMPEG_FAILED',
      );
    }
  }
}

export const FFMPEG_RUNNER = Symbol('FFMPEG_RUNNER');
