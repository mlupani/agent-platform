import {
  BRIEF_MAX_CHARS,
  sanitizeBrief,
  buildBriefSystemPrompt,
  buildBriefUserPrompt,
} from './suggest-brief';

describe('suggest-brief', () => {
  it('limpia fences y recorta el guion', () => {
    const long = 'A'.repeat(BRIEF_MAX_CHARS + 80);
    const cleaned = sanitizeBrief(`\`\`\`md\n${long}\n\`\`\``);
    expect(cleaned.startsWith('```')).toBe(false);
    expect(cleaned.length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
  });

  it('extrae instructions de un JSON accidental', () => {
    expect(
      sanitizeBrief('{"instructions":"HOOK\\nMostrá el local al amanecer"}'),
    ).toContain('Mostrá el local');
  });

  it('pide bloques de guion de video', () => {
    const prompt = buildBriefSystemPrompt({
      mediaType: 'VIDEO',
      durationSeconds: 5,
      objective: 'OFFER',
    });
    expect(prompt).toContain('5s');
    expect(prompt).toContain('HOOK');
    expect(prompt).toContain('VOZ');
    expect(prompt).toContain('HABLA');
    expect(prompt).toContain('acción principal');
    expect(prompt).toContain('ON-SCREEN');
    expect(prompt).toContain('Oferta');
  });

  it('incluye el negocio y el objetivo en el user prompt', () => {
    const prompt = buildBriefUserPrompt({
      businessName: 'Parrilla Don Julio',
      businessType: 'restaurant',
      description: 'Carnes a la leña',
      todayLabel: 'sábado 22 de agosto de 2026',
      objective: 'SERVICE_PROMOTION',
      mediaType: 'VIDEO',
      durationSeconds: 5,
      channels: ['INSTAGRAM_REEL'],
      selectedService: { name: 'Parrillada', description: null },
      services: '- Parrillada',
      hours: 'Sábado: 12:00-16:00',
      brand: 'Tono: cercano',
      recent: '—',
    });
    expect(prompt).toContain('Parrilla Don Julio');
    expect(prompt).toContain('Promoción de servicio');
    expect(prompt).toContain('Parrillada');
  });
});
