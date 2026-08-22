import { access } from 'node:fs/promises';
import { VideoProbeError } from './video-editor.errors';
import type { FfmpegRunner, VideoProbe } from './video-editor.types';

interface FfprobeJson {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
  }>;
}

export async function probeVideoFile(
  runner: FfmpegRunner,
  filePath: string,
  timeoutMs: number,
): Promise<VideoProbe> {
  try {
    await access(filePath);
  } catch {
    throw new VideoProbeError(`El archivo de video no existe: ${filePath}`);
  }

  let parsed: FfprobeJson;
  try {
    const { stdout } = await runner.probe(
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration,format_name:stream=index,codec_type,codec_name,width,height,duration',
        '-of',
        'json',
        filePath,
      ],
      timeoutMs,
    );
    parsed = JSON.parse(stdout) as FfprobeJson;
  } catch (error) {
    if (error instanceof VideoProbeError) throw error;
    const message = error instanceof Error ? error.message : 'ffprobe falló';
    throw new VideoProbeError(`No se pudo leer metadata del video: ${message}`);
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(
    video?.duration || parsed.format?.duration || 0,
  );
  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);

  if (!video) {
    throw new VideoProbeError('El archivo no contiene un stream de video');
  }
  if (!Number.isFinite(duration) || duration <= 0.2) {
    throw new VideoProbeError('Duración de video inválida');
  }
  if (!width || !height) {
    throw new VideoProbeError('Resolución de video inválida');
  }

  return {
    path: filePath,
    width,
    height,
    durationSeconds: duration,
    codecName: video.codec_name,
    formatName: parsed.format?.format_name,
    hasAudio: Boolean(audio),
    hasVideo: true,
  };
}

export function assertPlayableMp4(probe: VideoProbe): void {
  const format = (probe.formatName ?? '').toLowerCase();
  const playable =
    format.includes('mp4') ||
    format.includes('mov') ||
    format.includes('ismv') ||
    !format;
  if (!playable) {
    throw new VideoProbeError(
      `Formato de video no compatible para redes: ${probe.formatName ?? 'desconocido'}`,
    );
  }
  if (!probe.hasVideo) {
    throw new VideoProbeError('El video final no se puede reproducir (sin video)');
  }
}

export function assertDurationClose(
  actual: number,
  expected: number,
  toleranceSeconds: number,
): void {
  if (!Number.isFinite(actual) || actual <= 0) {
    throw new VideoProbeError('Duración de video inválida');
  }
  if (!Number.isFinite(expected) || expected <= 0) return;
  if (Math.abs(actual - expected) > Math.max(0.5, toleranceSeconds)) {
    throw new VideoProbeError(
      `Duración inesperada: ${actual.toFixed(1)}s (se esperaba ~${expected.toFixed(1)}s)`,
    );
  }
}
