import { VideoRoutingService } from './video-routing.service';
import { isRetryableVideoError } from './video.errors';
import { VideoProviderUnavailableError } from './video.errors';

describe('VideoRoutingService', () => {
  const kie = {
    name: 'kie' as const,
    isConfigured: jest.fn(() => true),
    generate: jest.fn(),
  };
  const fal = {
    name: 'fal' as const,
    isConfigured: jest.fn(() => true),
    generate: jest.fn(),
  };
  const veo = {
    name: 'veo' as const,
    isConfigured: jest.fn(() => true),
    generate: jest.fn(),
  };

  const factory = {
    get: (name: string) => {
      if (name === 'kie') return kie;
      if (name === 'veo') return veo;
      return fal;
    },
  };

  const envMap: Record<string, string> = {
    VIDEO_PROVIDER: 'kie',
    VIDEO_FALLBACK_PROVIDER: 'fal',
    VIDEO_FALLBACK_ENABLED: 'true',
  };

  const env = {
    get: (key: string) => envMap[key],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    kie.isConfigured.mockReturnValue(true);
    fal.isConfigured.mockReturnValue(true);
    veo.isConfigured.mockReturnValue(true);
    envMap.VIDEO_PROVIDER = 'kie';
    envMap.VIDEO_FALLBACK_PROVIDER = 'fal';
  });

  it('usa kie como primary', async () => {
    kie.generate.mockResolvedValue({ provider: 'kie', model: 'seedance' });
    const service = new VideoRoutingService(env as never, factory as never);
    const result = await service.generate({ prompt: 'short vertical ad' });
    expect(result.provider).toBe('kie');
    expect(fal.generate).not.toHaveBeenCalled();
  });

  it('usa veo si VIDEO_PROVIDER=veo', async () => {
    envMap.VIDEO_PROVIDER = 'veo';
    veo.generate.mockResolvedValue({
      provider: 'veo',
      model: 'veo-3.1-lite-generate-preview',
    });
    const service = new VideoRoutingService(env as never, factory as never);
    const result = await service.generate({ prompt: 'short vertical ad' });
    expect(result.provider).toBe('veo');
    expect(veo.generate).toHaveBeenCalled();
    expect(kie.generate).not.toHaveBeenCalled();
  });

  it('cae a fal si kie no está disponible', async () => {
    kie.generate.mockRejectedValue(
      new VideoProviderUnavailableError('kie', 'high demand'),
    );
    fal.generate.mockResolvedValue({ provider: 'fal', model: 'kling' });
    const service = new VideoRoutingService(env as never, factory as never);
    const result = await service.generate({ prompt: 'short vertical ad' });
    expect(result.provider).toBe('fal');
    expect(result.usedFallback).toBe(true);
  });

  it('no hace fallback en errores no transitorios', async () => {
    kie.generate.mockRejectedValue(new Error('prompt rejected'));
    const service = new VideoRoutingService(env as never, factory as never);
    await expect(
      service.generate({ prompt: 'short vertical ad' }),
    ).rejects.toThrow('prompt rejected');
    expect(fal.generate).not.toHaveBeenCalled();
  });
});

describe('isRetryableVideoError', () => {
  it('detecta alta demanda / timeout', () => {
    expect(isRetryableVideoError(new Error('high demand'))).toBe(true);
    expect(isRetryableVideoError(new Error('prompt too short'))).toBe(false);
  });
});
