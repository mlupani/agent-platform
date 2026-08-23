import { ConfigService } from '@nestjs/config';
import { VeoVideoProvider } from './veo.video.provider';

const generateVideos = jest.fn();
const getVideosOperation = jest.fn();
const download = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateVideos },
    operations: { getVideosOperation },
    files: { download },
  })),
}));

function config(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
    VEO_VIDEO_MODEL: 'veo-3.1-lite-generate-preview',
    VEO_VIDEO_ESTIMATED_COST: '0.20',
    VIDEO_TIMEOUT_MS: '20000',
    VIDEO_POLL_INTERVAL_MS: '1',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as never;
}

describe('VeoVideoProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no está configurado sin API key', () => {
    const provider = new VeoVideoProvider(config({ GOOGLE_GENERATIVE_AI_API_KEY: '' }));
    expect(provider.isConfigured()).toBe(false);
  });

  it('genera un MP4 720p con audio vía generateVideos + poll', async () => {
    const bytes = Buffer.from('fake-mp4');
    generateVideos.mockResolvedValue({ done: false });
    getVideosOperation.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          {
            video: {
              uri: 'https://example.com/video.mp4',
              mimeType: 'video/mp4',
              videoBytes: bytes.toString('base64'),
            },
          },
        ],
      },
    });

    const provider = new VeoVideoProvider(config());
    const result = await provider.generate({
      prompt: 'Un short de una cafetería',
      aspectRatio: '9:16',
      durationSeconds: 5,
      resolution: '720p',
      generateAudio: true,
    });

    expect(generateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'veo-3.1-lite-generate-preview',
        prompt: 'Un short de una cafetería',
        config: expect.objectContaining({
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 4,
          generateAudio: true,
        }),
      }),
    );
    expect(result.provider).toBe('veo');
    expect(result.buffer.equals(bytes)).toBe(true);
    expect(result.width).toBe(720);
    expect(result.height).toBe(1280);
    expect(result.durationSeconds).toBe(4);
    expect(result.model).toBe('veo-3.1-lite-generate-preview');
  });

  it('mapea 1:1 a 9:16 y 480p a 720p', async () => {
    generateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [{ video: { videoBytes: Buffer.from('x') } }],
      },
    });
    download.mockResolvedValue(Buffer.from('x'));

    const provider = new VeoVideoProvider(config());
    await provider.generate({
      prompt: 'clip',
      aspectRatio: '1:1',
      resolution: '480p',
      durationSeconds: 10,
    });

    expect(generateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 8,
        }),
      }),
    );
  });
});
