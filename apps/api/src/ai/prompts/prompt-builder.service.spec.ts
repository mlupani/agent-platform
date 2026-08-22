import { PromptBuilderService } from './prompt-builder.service';

describe('PromptBuilderService', () => {
  const builder = new PromptBuilderService();

  it('builds a dynamic prompt with business, hours and services', () => {
    const prompt = builder.buildFromContext({
      assistantName: 'Luna',
      tone: 'friendly',
      customInstructions: 'Sé breve y amable.',
      advancedInstructions: 'Priorizá turnos por la mañana.',
      business: {
        name: 'Demo Business',
        description: 'Negocio de prueba',
        type: 'OTHER',
        timezone: 'America/Argentina/Buenos_Aires',
        language: 'es',
        phone: '+54 11 5555-1234',
        email: 'hola@demo.test',
      },
      hoursText: 'Lunes: 09:00–13:00, 14:00–18:00\nDomingo: Cerrado',
      servicesText: '- Consulta inicial (30 min) — $15.000 [requiere cita]',
      configuredMessages: {
        welcome: 'Hola, ¿en qué ayudo?',
        handoff: 'Te derivo con alguien del equipo.',
      },
      knowledgeContext: '[#1] Abrimos de lunes a viernes.',
      memoryContext: 'Cliente preguntó por horarios.',
      enabledTools: ['getOpeningHours', 'getServices'],
      currentDateTime: {
        date: '2026-08-10',
        time: '17:30',
        weekday: 'lunes',
        timezone: 'America/Argentina/Buenos_Aires',
        tomorrowDate: '2026-08-11',
        tomorrowWeekday: 'martes',
      },
    });

    expect(prompt).toContain('Luna');
    expect(prompt).toContain('Demo Business');
    expect(prompt).toContain('Amigable');
    expect(prompt).toContain('09:00–13:00');
    expect(prompt).toContain('Consulta inicial');
    expect(prompt).toContain('Sé breve y amable');
    expect(prompt).toContain('Priorizá turnos');
    expect(prompt).toContain('getServices');
    expect(prompt).toContain('Abrimos de lunes a viernes');
    expect(prompt).toContain('2026-08-10');
    expect(prompt).toContain('2026-08-11');
    expect(prompt).toContain('martes');
    expect(prompt).not.toContain('embeddings');
    expect(prompt).not.toContain('vector database');
    expect(prompt).not.toContain('reseñas de Google');
  });

  it('includes the Google reviews link in confirmation instructions', () => {
    const prompt = builder.buildFromContext({
      assistantName: 'Luna',
      tone: 'friendly',
      business: {
        name: 'Demo Business',
        type: 'OTHER',
        timezone: 'America/Argentina/Buenos_Aires',
        language: 'es',
        googleReviewsUrl: 'https://g.page/r/demo/review',
      },
      hoursText: '',
      servicesText: '',
      configuredMessages: {},
      enabledTools: ['createAppointment', 'sendEmail', 'sendWhatsAppMessage'],
    });

    expect(prompt).toContain('https://g.page/r/demo/review');
    expect(prompt).toContain('reseñas de Google');
  });

  it('buildCurrentDateTime returns tomorrow relative to timezone', () => {
    const value = builder.buildCurrentDateTime(
      'America/Argentina/Buenos_Aires',
    );
    expect(value.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value.tomorrowDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(value.weekday.length).toBeGreaterThan(2);
    expect(value.tomorrowWeekday.length).toBeGreaterThan(2);
  });

  it('formats multi-range hours and services', () => {
    expect(
      builder.formatHours([
        {
          dayOfWeek: 0,
          isClosed: false,
          ranges: [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '18:00' },
          ],
        },
        { dayOfWeek: 6, isClosed: true, ranges: [] },
      ]),
    ).toContain('Lunes: 09:00–13:00, 14:00–18:00');

    expect(
      builder.formatServices([
        {
          name: 'Seguimiento',
          durationMinutes: 20,
          price: '10000',
          requiresAppointment: true,
        },
      ]),
    ).toContain('Seguimiento');
  });
});
