import { normalizeVideoEditing } from './normalize-editing';
import {
  clampTimeRange,
  fitOverlayText,
  normalizeHashtags,
  resolveOverlayRange,
  sanitizeOverlayText,
  wrapOverlayText,
} from './text-overlay';
import type { ContentStrategy } from '../content.types';

const baseStrategy: ContentStrategy = {
  topic: 'Parrilla',
  objective: 'SERVICE_PROMOTION',
  headline: '¿Ya sabés dónde vas a comer este finde? 🔥',
  caption: 'El finde se disfruta con una buena parrillada',
  cta: 'Reservá tu mesa',
  imagePrompt: 'cinematic steak',
  videoPrompt: 'cinematic steak on charcoal',
  visualStyle: 'warm cinematic',
  hook: '¿Ya sabés dónde vas a comer este finde? 🔥',
  hashtags: ['parrilla', '#gastronomia'],
  editing: {
    add_hook: true,
    hook_start: 0,
    hook_end: 3,
    hook_position: 'top',
    add_cta: true,
    cta_start: 9,
    cta_end: 12,
    cta_position: 'bottom',
    add_logo: true,
    logo_position: 'bottom-right',
  },
};

describe('normalizeVideoEditing', () => {
  it('respeta add_hook/add_cta/add_logo en false', () => {
    const result = normalizeVideoEditing({
      strategy: {
        ...baseStrategy,
        editing: { add_hook: false, add_cta: false, add_logo: false },
      },
      durationSeconds: 12,
      hasLogo: true,
    });
    expect(result.addHook).toBe(false);
    expect(result.addCta).toBe(false);
    expect(result.addLogo).toBe(false);
  });

  it('no pone logo si el negocio no tiene logo', () => {
    const result = normalizeVideoEditing({
      strategy: baseStrategy,
      durationSeconds: 12,
      hasLogo: false,
    });
    expect(result.addLogo).toBe(false);
  });

  it('si el LLM pide CTA 9-12s en un video de 10s, usa una ventana larga al final', () => {
    const result = normalizeVideoEditing({
      strategy: baseStrategy,
      durationSeconds: 10,
      hasLogo: true,
    });
    expect(result.addCta).toBe(true);
    expect(result.ctaEnd).toBe(10);
    expect(result.ctaStart).toBeLessThanOrEqual(4.5);
    expect(result.logoPosition).toBe('top-right');
  });

  it('no apaga el CTA si el LLM copia tiempos de un video más largo', () => {
    const result = normalizeVideoEditing({
      strategy: baseStrategy,
      durationSeconds: 5,
      hasLogo: true,
    });
    expect(result.addHook).toBe(true);
    expect(result.addCta).toBe(true);
    expect(result.ctaStart).toBeGreaterThanOrEqual(0);
    expect(result.ctaStart).toBeLessThan(result.ctaEnd);
    expect(result.ctaEnd).toBe(5);
    expect(result.hookEnd).toBeGreaterThan(2);
  });
});

describe('text overlay helpers', () => {
  it('saca emojis del texto quemado', () => {
    expect(sanitizeOverlayText('Hola 🔥 mundo')).toBe('Hola mundo');
  });

  it('wrappea en varias líneas', () => {
    const wrapped = wrapOverlayText('uno dos tres cuatro cinco seis', 10);
    expect(wrapped.split('\n').length).toBeGreaterThan(1);
  });

  it('normaliza hashtags', () => {
    expect(normalizeHashtags(['parrilla', '#parrilla', ' #gastro '])).toEqual([
      '#parrilla',
      '#gastro',
    ]);
  });

  it('descarta rangos inválidos', () => {
    expect(clampTimeRange(5, 5, 10)).toBeNull();
    expect(clampTimeRange(0, 3, 12)).toEqual({ start: 0, end: 3 });
  });

  it('cae a la ventana default si el LLM pide segundos fuera de duración', () => {
    const fallback = { start: 2.1, end: 5 };
    expect(resolveOverlayRange(9, 12, 5, fallback, 0.32)).toEqual(fallback);
  });

  it('achica la fuente del CTA para que entre el texto completo', () => {
    const fitted = fitOverlayText({
      text: 'Mandanos un mensaje directo y reserve tu turno',
      boxWidth: 612,
      preferredFontSize: 42,
      minFontSize: 16,
      maxLines: 2,
    });
    expect(fitted.text.replace(/\n/g, ' ')).toContain('reserve tu turno');
    expect(fitted.text).not.toMatch(/Mandanos un mensaje directo y$/);
    expect(fitted.fontSize).toBeLessThan(42);
    expect(fitted.lineCount).toBeGreaterThanOrEqual(1);
    expect(fitted.lineCount).toBeLessThanOrEqual(2);
  });
});
