import {
  clampDurationForFal,
  clampDurationForKie,
  clampDurationForVeo,
  parseVideoDuration,
} from './video-duration';

describe('video duration', () => {
  it('parsea 5, 10 y 15', () => {
    expect(parseVideoDuration(10)).toBe(10);
    expect(parseVideoDuration(15)).toBe(15);
    expect(parseVideoDuration(7)).toBe(5);
  });

  it('clampa Seedance 1.5 a 12s y Seedance 2 a 15s', () => {
    expect(clampDurationForKie('bytedance/seedance-1.5-pro', 15)).toBe(12);
    expect(clampDurationForKie('bytedance/seedance-1.5-pro', 10)).toBe(10);
    expect(clampDurationForKie('bytedance/seedance-2', 15)).toBe(15);
    expect(clampDurationForKie('bytedance/seedance-2.0', 15)).toBe(15);
  });

  it('clampa Kling 2.6 a 5 o 10 y Kling 3.0 a 3–15', () => {
    expect(clampDurationForKie('kling-2.6/text-to-video', 15)).toBe(10);
    expect(clampDurationForKie('kling-2.6/text-to-video', 10)).toBe(10);
    expect(clampDurationForKie('kling-2.6/image-to-video', 5)).toBe(5);
    expect(clampDurationForKie('kling-3.0/video', 15)).toBe(15);
    expect(clampDurationForKie('kling-3.0/video', 2)).toBe(3);
  });

  it('clampa Gemini Omni a 4, 6, 8 o 10', () => {
    expect(clampDurationForKie('gemini-omni-video', 5)).toBe(4);
    expect(clampDurationForKie('gemini-omni-video', 10)).toBe(10);
    expect(clampDurationForKie('gemini-omni-video', 15)).toBe(10);
    expect(clampDurationForKie('gemini-omni-video', 7)).toBe(6);
  });

  it('clampa Kling v1 de fal a 5 o 10', () => {
    expect(
      clampDurationForFal('fal-ai/kling-video/v1/standard/text-to-video', 15),
    ).toBe(10);
    expect(
      clampDurationForFal('fal-ai/kling-video/v1/standard/text-to-video', 5),
    ).toBe(5);
  });

  it('clampa Veo a 4, 6 u 8s', () => {
    expect(clampDurationForVeo(5)).toBe(4);
    expect(clampDurationForVeo(10)).toBe(8);
    expect(clampDurationForVeo(15)).toBe(8);
    expect(clampDurationForVeo(6)).toBe(6);
    expect(clampDurationForVeo(7)).toBe(6);
    expect(clampDurationForVeo(1)).toBe(4);
  });
});
