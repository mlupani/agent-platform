import {
  buildKieMarketInput,
  isSeedance2Model,
  resolveKieVideoModel,
} from './kie-market-input';

const refs = [
  'https://cdn.example.com/a.jpg',
  'https://cdn.example.com/b.jpg',
];

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
