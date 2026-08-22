import { readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVideoEditorSettings } from './video-editor.config';
import { VideoEditorService } from './video-editor.service';
import { VideoEditError } from './video-editor.errors';
import { probeVideoFile } from './video-probe';
import type {
  FfmpegRunner,
  VideoEditingInstructions,
} from './video-editor.types';

function instructions(
  overrides: Partial<VideoEditingInstructions> = {},
): VideoEditingInstructions {
  return {
    addHook: false,
    hookText: '',
    hookStart: 0,
    hookEnd: 3,
    hookPosition: 'top',
    addCta: false,
    ctaText: '',
    ctaStart: 9,
    ctaEnd: 12,
    ctaPosition: 'bottom',
    addLogo: false,
    logoPosition: 'bottom-right',
    ...overrides,
  };
}

function probeJson(overrides?: {
  width?: number;
  height?: number;
  duration?: number;
  format?: string;
  hasAudio?: boolean;
}) {
  const width = overrides?.width ?? 720;
  const height = overrides?.height ?? 1280;
  const duration = String(overrides?.duration ?? 12);
  const streams: unknown[] = [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width,
      height,
      duration,
    },
  ];
  if (overrides?.hasAudio !== false) {
    streams.push({ codec_type: 'audio', codec_name: 'aac', duration });
  }
  return JSON.stringify({
    format: {
      duration,
      format_name: overrides?.format ?? 'mov,mp4,m4a,3gp,3g2,mj2',
    },
    streams,
  });
}

function mockConfig(values: Record<string, string> = {}) {
  const env: Record<string, string> = {
    VIDEO_EDITOR_ENABLED: 'true',
    VIDEO_EDITOR_FONT_FILE: 'C:/Windows/Fonts/arial.ttf',
    VIDEO_RESOLUTION: '720p',
    ...values,
  };
  return {
    get: (key: string) => env[key],
  };
}

describe('VideoEditorService', () => {
  const runner: FfmpegRunner = {
    run: jest.fn(),
    probe: jest.fn(),
    ffmpegPath: () => 'ffmpeg',
    ffprobePath: () => 'ffprobe',
  };

  let service: VideoEditorService;
  const fontFile = join(tmpdir(), `video-editor-test-font.ttf`);

  beforeAll(async () => {
    await writeFile(fontFile, 'font');
  });

  afterAll(async () => {
    await rm(fontFile, { force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (runner.run as jest.Mock).mockResolvedValue({ stdout: '', stderr: '' });
    (runner.probe as jest.Mock).mockResolvedValue({
      stdout: probeJson(),
      stderr: '',
    });
    service = new VideoEditorService(
      mockConfig({ VIDEO_EDITOR_FONT_FILE: fontFile }) as never,
      runner,
    );
  });

  it('omite la edición si no hay hook, CTA ni logo y el video ya es 9:16', async () => {
    const result = await service.edit({
      videoBuffer: Buffer.from('fake-mp4'),
      instructions: instructions(),
      branding: {},
      expectedDurationSeconds: 12,
    });
    expect(result.skipped).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('aplica hook', async () => {
    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      const result = await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({
          addHook: true,
          hookText: '¿Ya sabés dónde vas a comer?',
        }),
        branding: {},
      });
      expect(result.skipped).toBe(false);
      const filter = (
        (runner.run as jest.Mock).mock.calls[0][0] as string[]
      ).join(' ');
      expect(filter).toContain('drawtext=');
      expect(filter).toContain('hook.txt');
      expect(filter).not.toContain('cta.txt');
    });
  });

  it('aplica CTA aunque el LLM pida segundos 9-12 en un video de 5s', async () => {
    (runner.probe as jest.Mock).mockResolvedValue({
      stdout: probeJson({ duration: 5 }),
      stderr: '',
    });
    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({
          addCta: true,
          ctaText: 'Reservá tu mesa',
          ctaStart: 9,
          ctaEnd: 12,
        }),
        branding: { primaryColor: '#111111' },
        expectedDurationSeconds: 5,
      });
      const filter = (
        (runner.run as jest.Mock).mock.calls[0][0] as string[]
      ).join(' ');
      expect(filter).toContain('cta.txt');
      expect(filter).toContain('drawbox=');
      expect(filter).toContain('0x111111');
    });
  });

  it('aplica CTA', async () => {
    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({
          addCta: true,
          ctaText: 'Reservá tu mesa',
        }),
        branding: {},
      });
      const filter = (
        (runner.run as jest.Mock).mock.calls[0][0] as string[]
      ).join(' ');
      expect(filter).toContain('cta.txt');
      expect(filter).not.toContain('hook.txt');
    });
  });

  it('aplica hook + CTA', async () => {
    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({
          addHook: true,
          hookText: 'Este finde, parrilla',
          addCta: true,
          ctaText: 'Reservá tu mesa',
        }),
        branding: {},
      });
      const filter = (
        (runner.run as jest.Mock).mock.calls[0][0] as string[]
      ).join(' ');
      expect(filter).toContain('hook.txt');
      expect(filter).toContain('cta.txt');
    });
  });

  it('aplica logo', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as Response);

    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({ addLogo: true }),
        branding: { logoUrl: 'https://cdn.example/logo.png' },
      });
      const args = (runner.run as jest.Mock).mock.calls[0][0] as string[];
      expect(args.join(' ')).toContain('logo.png');
      expect(args.join(' ')).toContain('overlay=');
    });

    fetchMock.mockRestore();
  });

  it('aplica hook + CTA + logo', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response);

    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({
          addHook: true,
          hookText: 'Hook',
          addCta: true,
          ctaText: 'CTA',
          addLogo: true,
        }),
        branding: { logoUrl: 'https://cdn.example/logo.png' },
      });
      const filter = (
        (runner.run as jest.Mock).mock.calls[0][0] as string[]
      ).join(' ');
      expect(filter).toContain('hook.txt');
      expect(filter).toContain('cta.txt');
      expect(filter).toContain('overlay=');
    });

    fetchMock.mockRestore();
  });

  it('convierte a 9:16 si el video no es vertical', async () => {
    (runner.probe as jest.Mock).mockResolvedValue({
      stdout: probeJson({ width: 1920, height: 1080, duration: 10 }),
      stderr: '',
    });
    await withOutputFile(async (writeOutput) => {
      (runner.run as jest.Mock).mockImplementation(async (args: string[]) => {
        await writeOutput(args);
        return { stdout: '', stderr: '' };
      });
      const result = await service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions(),
        branding: {},
      });
      expect(result.skipped).toBe(false);
      const filter = (
        (runner.run as jest.Mock).mock.calls[0][0] as string[]
      ).join(' ');
      expect(filter).toContain('force_original_aspect_ratio=increase');
      expect(filter).toContain('crop=720:1280');
    });
  });

  it('propaga el error de FFmpeg', async () => {
    (runner.run as jest.Mock).mockRejectedValue(
      new VideoEditError('drawtext failed', 'FFMPEG_FAILED'),
    );
    await expect(
      service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({ addHook: true, hookText: 'Hola' }),
        branding: {},
      }),
    ).rejects.toThrow('drawtext failed');
  });

  it('falla si el archivo de video no existe', async () => {
    await expect(
      probeVideoFile(runner, join(tmpdir(), 'missing-video-xyz.mp4'), 1000),
    ).rejects.toThrow('no existe');
  });

  it('falla si la duración es incorrecta', async () => {
    (runner.probe as jest.Mock).mockResolvedValue({
      stdout: probeJson({ duration: 1.2 }),
      stderr: '',
    });
    await expect(
      service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions(),
        branding: {},
        expectedDurationSeconds: 12,
      }),
    ).rejects.toThrow(/Duración inesperada/);
  });

  it('limpia temporales si FFmpeg falla', async () => {
    (runner.run as jest.Mock).mockRejectedValue(new VideoEditError('boom'));
    const before = new Set(await readdir(tmpdir()));
    await expect(
      service.edit({
        videoBuffer: Buffer.from('fake-mp4'),
        instructions: instructions({ addHook: true, hookText: 'Hola' }),
        branding: {},
      }),
    ).rejects.toThrow('boom');
    const leftover = (await readdir(tmpdir())).filter(
      (name) => name.startsWith('video-edit-') && !before.has(name),
    );
    expect(leftover).toEqual([]);
  });
});

async function withOutputFile(
  run: (writeOutput: (args: string[]) => Promise<void>) => Promise<void>,
) {
  await run(async (args) => {
    const outputPath = args[args.length - 1];
    await writeFile(outputPath, Buffer.from('edited-mp4'));
  });
}

describe('loadVideoEditorSettings', () => {
  it('usa 9:16 720p por defecto', () => {
    const settings = loadVideoEditorSettings({
      get: (key: string) => (key === 'VIDEO_RESOLUTION' ? '720p' : undefined),
    } as never);
    expect(settings.targetWidth).toBe(720);
    expect(settings.targetHeight).toBe(1280);
    expect(settings.enabled).toBe(true);
  });
});
