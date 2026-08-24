import { CompositionService } from './composition.service';
import { ConfigService } from '@nestjs/config';

describe('CompositionService', () => {
  const mockPrisma = {
    generatedContent: { findFirst: jest.fn() },
    audioAsset: { findFirst: jest.fn() },
    contentAsset: { create: jest.fn(), findMany: jest.fn() },
    contentGenerationExecution: { create: jest.fn() },
  };
  const mockBusinesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const mockStorage = { upload: jest.fn(async () => ({ url: 'https://cloudinary.com/video.mp4', publicId: 'pub' })) };
  const mockRunner = {
    run: jest.fn(async () => {}),
    ffprobePath: () => 'ffprobe',
  };

  const businessId = 'biz-1';
  const contentId = 'content-1';

  const originalAsset = {
    id: 'orig-1',
    role: 'ORIGINAL',
    type: 'VIDEO',
    storageUrl: 'https://example.com/video.mp4',
    storagePublicId: 'orig',
  };

  const audioAssetBase = {
    id: 'audio-1',
    businessId,
    contentId,
    provider: 'elevenlabs',
    voiceId: 'sofia',
    text: 'Hola Villa Crespo',
    storageUrl: 'https://example.com/audio.mp3',
    storagePublicId: 'audio-pub',
    status: 'COMPLETED',
    durationSeconds: 3,
  };

  function service() {
    const cfg = { get: (k: string) => undefined } as unknown as ConfigService;
    return new CompositionService(
      mockPrisma as any,
      mockBusinesses as any,
      cfg,
      mockRunner as any,
      mockStorage as any,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('video.mp4')) {
        return new Response(Buffer.from('fake-video'), { status: 200 }) as unknown as Response;
      }
      if (u.includes('audio.mp3')) {
        return new Response(Buffer.from('fake-audio'), { status: 200 }) as unknown as Response;
      }
      return new Response(null, { status: 404 }) as unknown as Response;
    }) as unknown as typeof fetch;

    mockPrisma.generatedContent.findFirst.mockResolvedValue({
      id: contentId,
      businessId,
      mediaType: 'VIDEO',
      assets: [originalAsset],
    });
    mockPrisma.audioAsset.findFirst.mockResolvedValue(audioAssetBase);
    mockPrisma.contentAsset.create.mockResolvedValue({ id: 'composed-1' });

    // Mock ffprobe via child_process execFile — composition probes durations via ffprobe
    // We'll mock fs/promises access and probeVideoFile
    jest.spyOn(require('node:fs/promises'), 'access').mockResolvedValue(undefined as any);
    jest.spyOn(require('node:fs/promises'), 'readFile').mockResolvedValue(Buffer.from('composed-video') as any);
    jest.spyOn(require('node:fs/promises'), 'writeFile').mockResolvedValue(undefined as any);
    jest.spyOn(require('node:fs/promises'), 'mkdtemp').mockResolvedValue('/tmp/compose-test' as any);
    jest.spyOn(require('node:fs/promises'), 'rm').mockResolvedValue(undefined as any);

    // Mock probeVideoFile and execFile for audio duration
    const videoProbe = require('../content/video-editor/video-probe');
    jest.spyOn(videoProbe, 'probeVideoFile').mockImplementation(async (runner, path) => {
      if (String(path).includes('input.mp4') || String(path).includes('output.mp4')) {
        return { width: 720, height: 1280, durationSeconds: 5, codecName: 'h264', formatName: 'mp4', hasAudio: true, hasVideo: true, path } as any;
      }
      // output probe
      return { width: 720, height: 1280, durationSeconds: 5, codecName: 'h264', formatName: 'mp4', hasAudio: true, hasVideo: true, path } as any;
    });
    jest.spyOn(videoProbe, 'assertPlayableMp4').mockImplementation(() => {});

    const child = require('node:child_process');
    if (!child.execFile.__isMock) {
      jest.spyOn(child, 'execFile').mockImplementation((cmd, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts as any;
          opts = {};
        }
        // ffprobe for audio duration returns json
        const stdout = JSON.stringify({ format: { duration: '2.5' } });
        (cb as Function)(null, stdout, '');
        return {} as any;
      });
    }
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('compone video + audio manteniendo original intacto', async () => {
    const svc = service();
    const result = await svc.replaceAudio({ contentId, audioAssetId: audioAssetBase.id });
    expect(result.originalAsset.id).toBe(originalAsset.id);
    expect(result.composedAsset).toBeDefined();
    expect(mockPrisma.contentAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'COMPOSED' }) }),
    );
    // Original asset not deleted
    expect(mockPrisma.contentAsset.create).toHaveBeenCalledTimes(1);
  });

  it('crea múltiples versiones (segundo audio genera otro COMPOSED)', async () => {
    const svc = service();
    await svc.replaceAudio({ contentId, audioAssetId: audioAssetBase.id });
    const secondAudio = { ...audioAssetBase, id: 'audio-2', text: 'Otra versión' };
    mockPrisma.audioAsset.findFirst.mockResolvedValueOnce(secondAudio);
    // Need to re-mock generatedContent for second call (same)
    mockPrisma.generatedContent.findFirst.mockResolvedValue({
      id: contentId,
      businessId,
      mediaType: 'VIDEO',
      assets: [originalAsset, { id: 'composed-1', role: 'COMPOSED', type: 'VIDEO', storageUrl: 'https://example.com/composed.mp4' }],
    });
    await svc.replaceAudio({ contentId, audioAssetId: secondAudio.id });
    expect(mockPrisma.contentAsset.create).toHaveBeenCalledTimes(2);
  });

  it('maneja audio más largo que video con error claro y no corta narración', async () => {
    const longAudio = { ...audioAssetBase, durationSeconds: 10 };
    mockPrisma.audioAsset.findFirst.mockResolvedValue(longAudio);

    const svc = service();
    jest.spyOn(svc as unknown as { probeAudioDuration: (p: string) => Promise<number> }, 'probeAudioDuration').mockResolvedValue(10);

    await expect(svc.replaceAudio({ contentId, audioAssetId: longAudio.id })).rejects.toThrow(
      /El audio dura .* y el video/i,
    );
  });

  it('usa -c:v copy sin recodificar video (verifica args no contienen re-encode video)', async () => {
    const svc = service();
    await svc.replaceAudio({ contentId, audioAssetId: audioAssetBase.id });
    const runArgs = mockRunner.run.mock.calls[0][0] as string[];
    expect(runArgs).toContain('-c:v');
    expect(runArgs).toContain('copy');
    expect(runArgs).toContain('-c:a');
    expect(runArgs).toContain('aac');
    // Should not contain libx264 re-encode for video
    expect(runArgs.join(' ')).not.toMatch(/libx264.*-crf/);
  });

  it('mantiene video original intacto (no sobrescribe ORIGINAL)', async () => {
    const svc = service();
    const beforeAssets = [originalAsset];
    mockPrisma.generatedContent.findFirst.mockResolvedValue({
      id: contentId,
      businessId,
      mediaType: 'VIDEO',
      assets: beforeAssets,
    });
    await svc.replaceAudio({ contentId, audioAssetId: audioAssetBase.id });
    // Ensure we didn't delete original
    // CompositionService should not call delete on ORIGINAL, only create COMPOSED
    expect(mockPrisma.contentAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'VIDEO' }) }),
    );
    // Original still there
    expect(beforeAssets[0].role).toBe('ORIGINAL');
  });

  it('maneja video inexistente con error amigable', async () => {
    mockPrisma.generatedContent.findFirst.mockResolvedValue(null);
    const svc = service();
    await expect(svc.replaceAudio({ contentId: 'nope', audioAssetId: audioAssetBase.id })).rejects.toThrow(
      /Contenido no encontrado/,
    );
  });

  it('maneja audio inexistente', async () => {
    mockPrisma.audioAsset.findFirst.mockResolvedValue(null);
    const svc = service();
    await expect(svc.replaceAudio({ contentId, audioAssetId: 'no-audio' })).rejects.toThrow(
      /Audio no encontrado/,
    );
  });
});
