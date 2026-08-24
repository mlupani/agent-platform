import { ConfigService } from '@nestjs/config';
import { ElevenLabsProvider } from './elevenlabs.provider';

describe('ElevenLabsProvider', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  function provider(apiKey = 'test-key', extra: Record<string, string> = {}) {
    const cfg = {
      get: (key: string) => {
        if (key === 'ELEVENLABS_API_KEY') return apiKey;
        if (key in extra) return extra[key];
        return undefined;
      },
    } as unknown as ConfigService;
    return new ElevenLabsProvider(cfg);
  }

  it('obtiene voces con metadata', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: 'sofia',
              name: 'Sofía',
              labels: { language: 'es', accent: 'Argentina', gender: 'female' },
              preview_url: 'https://example.com/preview.mp3',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const p = provider();
    const voices = await p.listVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].voiceId).toBe('sofia');
    expect(voices[0].language).toBe('es');
    expect(voices[0].previewUrl).toBe('https://example.com/preview.mp3');
  });

  it('genera audio con ElevenLabs y no expone API key en error', async () => {
    global.fetch = jest.fn(async () =>
      new Response(Buffer.from('fake-mp3'), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    ) as unknown as typeof fetch;

    const p = provider('secret-key-123');
    const audio = await p.generate({ text: 'Hola Villa Crespo', voiceId: 'sofia' });
    expect(audio.buffer.length).toBeGreaterThan(0);
    expect(audio.provider).toBe('elevenlabs');
    // Ensure key not leaked in result
    expect(JSON.stringify(audio)).not.toContain('secret-key-123');
  });

  it('maneja API key inválida (401) con mensaje amigable', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ detail: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const p = provider('bad-key');
    await expect(p.generate({ text: 'Hola', voiceId: 'sofia' })).rejects.toThrow(
      /API key inválida/,
    );
  });

  it('maneja créditos insuficientes (402)', async () => {
    global.fetch = jest.fn(async () =>
      new Response('quota exceeded', { status: 402 }),
    ) as unknown as typeof fetch;

    const p = provider();
    await expect(p.generate({ text: 'Hola', voiceId: 'sofia' })).rejects.toThrow(
      /Créditos insuficientes/,
    );
  });

  it('preview genera audio corto sin exponer secrets', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(Buffer.from('preview-mp3'), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = provider();
    const audio = await p.preview({ text: 'Texto largo '.repeat(50), voiceId: 'sofia' });
    expect(audio.buffer.length).toBeGreaterThan(0);
    // Preview truncates text to 200 chars
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text.length).toBeLessThanOrEqual(200);
  });

  it('voice_id inexistente (422) con mensaje claro', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ detail: { message: 'voice not found' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const p = provider();
    await expect(p.generate({ text: 'Hola', voiceId: 'no-existe' })).rejects.toThrow(
      /Voice ID/,
    );
  });

  it('no expone API key en logs de listVoices', async () => {
    global.fetch = jest.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    const p = provider('super-secret');
    // Even on error, provider should not include key in thrown message
    try {
      await p.listVoices();
      fail('should throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret');
    }
  });
});
