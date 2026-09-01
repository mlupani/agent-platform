import {
  buildKieMarketInput,
  isGeminiOmniModel,
  isKling26Model,
  isKling3Model,
  isSeedance2Model,
  resolveKieVideoModel,
  resolveKlingModelForRefs,
} from './kie-market-input';

const refs = ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'];

describe('kie market input', () => {
  it('alias seedance-2.0 al id oficial de Kie', () => {
    expect(resolveKieVideoModel('bytedance/seedance-2.0')).toBe(
      'bytedance/seedance-2',
    );
    expect(resolveKieVideoModel('bytedance/seedance-2-fast')).toBe(
      'bytedance/seedance-2-fast',
    );
    expect(resolveKieVideoModel('bytedance/seedance-1.5-pro')).toBe(
      'bytedance/seedance-1.5-pro',
    );
  });

  it('detecta la familia Seedance 2', () => {
    expect(isSeedance2Model('bytedance/seedance-2')).toBe(true);
    expect(isSeedance2Model('bytedance/seedance-2.0')).toBe(true);
    expect(isSeedance2Model('bytedance/seedance-2-fast')).toBe(true);
    expect(isSeedance2Model('bytedance/seedance-1.5-pro')).toBe(false);
  });

  it('arma el payload 1.5 Pro (input_urls)', () => {
    const body = buildKieMarketInput({
      model: 'bytedance/seedance-1.5-pro',
      prompt: 'clip de peluquería',
      aspectRatio: '9:16',
      durationSeconds: 10,
      generateAudio: true,
      resolution: '720p',
      referenceImageUrls: refs,
    });
    expect(body).toEqual({
      prompt: 'clip de peluquería',
      aspect_ratio: '9:16',
      duration: 10,
      generate_audio: true,
      resolution: '720p',
      input_urls: refs,
      image_urls: refs,
    });
    expect(body).not.toHaveProperty('first_frame_url');
  });

  it('arma el payload Seedance 2 (first/last frame)', () => {
    const body = buildKieMarketInput({
      model: 'bytedance/seedance-2.0',
      prompt: 'clip de peluquería',
      aspectRatio: '9:16',
      durationSeconds: 15,
      generateAudio: true,
      resolution: '720p',
      referenceImageUrls: refs,
    });
    expect(body).toEqual({
      prompt: 'clip de peluquería',
      aspect_ratio: '9:16',
      duration: 15,
      generate_audio: true,
      resolution: '720p',
      first_frame_url: refs[0],
      last_frame_url: refs[1],
    });
    expect(body).not.toHaveProperty('input_urls');
    expect(body).not.toHaveProperty('image_urls');
  });
});

describe('kie market input — Kling', () => {
  it('resuelve los alias de Kling a los ids de Kie', () => {
    expect(resolveKieVideoModel('kling-3.0-omni')).toBe('kling-3.0/video');
    expect(resolveKieVideoModel('kling-3.0')).toBe('kling-3.0/video');
    expect(resolveKieVideoModel('kling-3')).toBe('kling-3.0/video');
    expect(resolveKieVideoModel('kling-2.6')).toBe('kling-2.6/text-to-video');
    expect(resolveKieVideoModel('kling-2.6/video')).toBe(
      'kling-2.6/text-to-video',
    );
  });

  it('detecta las familias Kling 3.0 y 2.6', () => {
    expect(isKling3Model('kling-3.0-omni')).toBe(true);
    expect(isKling3Model('kling-3.0/video')).toBe(true);
    expect(isKling3Model('kling-2.6')).toBe(false);
    expect(isKling26Model('kling-2.6')).toBe(true);
    expect(isKling26Model('kling-2.6/image-to-video')).toBe(true);
    expect(isKling26Model('kling-3.0/video')).toBe(false);
  });

  it('cambia a image-to-video sólo cuando hay refs y es Kling 2.6 t2v', () => {
    expect(resolveKlingModelForRefs('kling-2.6/text-to-video', true)).toBe(
      'kling-2.6/image-to-video',
    );
    expect(resolveKlingModelForRefs('kling-2.6/text-to-video', false)).toBe(
      'kling-2.6/text-to-video',
    );
    expect(resolveKlingModelForRefs('kling-2.6', true)).toBe(
      'kling-2.6/image-to-video',
    );
    expect(resolveKlingModelForRefs('kling-3.0-omni', true)).toBe(
      'kling-3.0/video',
    );
  });

  it('arma el payload Kling 3.0 (sound + mode + duration string)', () => {
    const body = buildKieMarketInput({
      model: 'kling-3.0-omni',
      prompt: 'pilates reformer flow, cinematic',
      aspectRatio: '9:16',
      durationSeconds: 10,
      generateAudio: true,
    });
    expect(body).toEqual({
      prompt: 'pilates reformer flow, cinematic',
      aspect_ratio: '9:16',
      duration: '10',
      sound: true,
      mode: 'pro',
      multi_shots: false,
    });
  });

  it('Kling 3.0 deriva el mode de la resolución y acepta override', () => {
    expect(
      buildKieMarketInput({
        model: 'kling-3.0/video',
        prompt: 'x',
        aspectRatio: '16:9',
        durationSeconds: 5,
        generateAudio: false,
        resolution: '720p',
      }).mode,
    ).toBe('std');
    expect(
      buildKieMarketInput({
        model: 'kling-3.0/video',
        prompt: 'x',
        aspectRatio: '16:9',
        durationSeconds: 5,
        generateAudio: false,
        resolution: '720p',
        klingMode: '4K',
      }).mode,
    ).toBe('4K');
  });

  it('Kling 3.0 pasa image_urls como first/last frame cuando hay refs', () => {
    const body = buildKieMarketInput({
      model: 'kling-3.0/video',
      prompt: 'x',
      aspectRatio: '9:16',
      durationSeconds: 5,
      generateAudio: false,
      referenceImageUrls: refs,
    });
    expect(body.image_urls).toEqual(refs);
  });

  it('arma el payload Kling 2.6 text-to-video (con aspect_ratio, sin imagen)', () => {
    const body = buildKieMarketInput({
      model: 'kling-2.6',
      prompt: 'clip de pilates',
      aspectRatio: '9:16',
      durationSeconds: 10,
      generateAudio: true,
    });
    expect(body).toEqual({
      prompt: 'clip de pilates',
      sound: true,
      aspect_ratio: '9:16',
      duration: '10',
    });
    expect(body).not.toHaveProperty('image_urls');
  });

  it('arma el payload Kling 2.6 image-to-video (1 imagen, sin aspect_ratio)', () => {
    const body = buildKieMarketInput({
      model: 'kling-2.6',
      prompt: 'clip de pilates',
      aspectRatio: '9:16',
      durationSeconds: 5,
      generateAudio: false,
      referenceImageUrls: refs,
    });
    expect(body).toEqual({
      prompt: 'clip de pilates',
      sound: false,
      duration: '5',
      image_urls: [refs[0]],
    });
    expect(body).not.toHaveProperty('aspect_ratio');
  });
});

describe('kie market input — Gemini Omni', () => {
  it('resuelve los alias de Gemini Omni al id de Kie', () => {
    expect(resolveKieVideoModel('gemini-omni-flash-1-1')).toBe(
      'gemini-omni-video',
    );
    expect(resolveKieVideoModel('gemini-omni-1.1-flash')).toBe(
      'gemini-omni-video',
    );
    expect(resolveKieVideoModel('gemini-omni')).toBe('gemini-omni-video');
    expect(isGeminiOmniModel('gemini-omni-flash-1-1')).toBe(true);
    expect(isGeminiOmniModel('kling-3.0/video')).toBe(false);
  });

  it('arma el payload Gemini Omni (duration string, sin campo de audio)', () => {
    const body = buildKieMarketInput({
      model: 'gemini-omni-flash-1-1',
      prompt: 'reformer flow, cinematic',
      aspectRatio: '9:16',
      durationSeconds: 8,
      generateAudio: true,
      resolution: '1080p',
    });
    expect(body).toEqual({
      prompt: 'reformer flow, cinematic',
      aspect_ratio: '9:16',
      duration: '8',
      resolution: '1080p',
    });
    expect(body).not.toHaveProperty('sound');
    expect(body).not.toHaveProperty('generate_audio');
  });

  it('Gemini Omni: normaliza aspect_ratio y resolution, y pasa hasta 7 image_urls', () => {
    const many = Array.from(
      { length: 9 },
      (_, i) => `https://cdn.example.com/${i}.jpg`,
    );
    const body = buildKieMarketInput({
      model: 'gemini-omni-video',
      prompt: 'x',
      aspectRatio: '1:1',
      durationSeconds: 4,
      generateAudio: false,
      resolution: '480p',
      referenceImageUrls: many,
    });
    expect(body.aspect_ratio).toBe('9:16');
    expect(body.resolution).toBe('720p');
    expect((body.image_urls as string[]).length).toBe(7);
  });
});
