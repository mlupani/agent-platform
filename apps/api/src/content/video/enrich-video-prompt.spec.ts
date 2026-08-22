import {
  enrichMarketingVideoPrompt,
  hasPhysicalObjectInteraction,
} from './enrich-video-prompt';

describe('enrich-video-prompt', () => {
  it('detecta interacción física con manos u objetos', () => {
    expect(
      hasPhysicalObjectInteraction(
        'The chef slowly stirs the stew with a wooden spoon',
      ),
    ).toBe(true);
    expect(
      hasPhysicalObjectInteraction(
        'A woman holds a glass of wine and smiles at camera',
      ),
    ).toBe(true);
  });

  it('no marca talking-head ni producto estático como interacción física', () => {
    expect(
      hasPhysicalObjectInteraction(
        'Owner talks to camera in a bright salon, slight smile, locked-off shot',
      ),
    ).toBe(false);
    expect(
      hasPhysicalObjectInteraction(
        'Cinematic close-up of a plated steak on charcoal, steam rising, slow push-in',
      ),
    ).toBe(false);
  });

  it('siempre pide una sola acción continua', () => {
    const prompt = enrichMarketingVideoPrompt({
      basePrompt: 'Owner talks to camera about weekend reservations',
      durationSeconds: 5,
    });
    expect(prompt).toContain('one clear primary action');
    expect(prompt).toContain('slow, controlled movement');
    expect(prompt).toContain('9:16');
    expect(prompt).not.toContain('PHYSICAL INTERACTION');
  });

  it('enriquece grip y objeto solo si hay manipulación', () => {
    const prompt = enrichMarketingVideoPrompt({
      basePrompt: 'The chef cooks using a spoon',
      durationSeconds: 10,
    });
    expect(prompt).toContain('PHYSICAL INTERACTION');
    expect(prompt).toContain('stable realistic grip');
    expect(prompt).toContain('consistent object shape and size');
    expect(prompt).toContain('which hand holds it');
  });
});
