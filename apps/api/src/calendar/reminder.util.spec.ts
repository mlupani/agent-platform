import {
  clampReminderHours,
  isReminderDue,
  normalizeReminderChannels,
  normalizeReminderEmail,
  normalizeReminderPhone,
  pickReminderChannel,
  reminderDueWindow,
  reminderServiceClause,
  renderReminderMessage,
} from './reminder.util';

describe('reminder.util', () => {
  it('clamps hours to 1–24', () => {
    expect(clampReminderHours(0)).toBe(1);
    expect(clampReminderHours(48)).toBe(24);
    expect(clampReminderHours(3.6)).toBe(4);
    expect(clampReminderHours('nope')).toBe(24);
  });

  it('normalizes channels keeping order and dropping invalids', () => {
    expect(normalizeReminderChannels(['email', 'whatsapp', 'email', 'sms'])).toEqual(
      ['email', 'whatsapp'],
    );
    expect(normalizeReminderChannels([])).toEqual([
      'whatsapp',
      'email',
      'instagram',
      'facebook',
    ]);
  });

  it('detects the due window for a 24h reminder', () => {
    const now = new Date('2026-08-22T12:00:00.000Z');
    const window = reminderDueWindow(now, 24);
    expect(window.to.toISOString()).toBe('2026-08-23T12:00:00.000Z');
    expect(window.from.toISOString()).toBe('2026-08-23T11:30:00.000Z');

    expect(
      isReminderDue({
        now,
        hoursBefore: 24,
        startsAt: new Date('2026-08-23T12:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isReminderDue({
        now,
        hoursBefore: 24,
        startsAt: new Date('2026-08-23T11:00:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isReminderDue({
        now,
        hoursBefore: 24,
        startsAt: new Date('2026-08-22T11:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('picks the first channel with data and integration', () => {
    const availability = {
      whatsappReady: true,
      emailReady: true,
      instagramReady: true,
      facebookReady: true,
      phone: '5491100000000',
      email: 'ana@test.com',
      instagramThread: true,
      facebookThread: true,
    };
    expect(
      pickReminderChannel(['whatsapp', 'email'], availability),
    ).toBe('whatsapp');
    expect(
      pickReminderChannel(
        ['whatsapp', 'email'],
        { ...availability, whatsappReady: false },
      ),
    ).toBe('email');
    expect(
      pickReminderChannel(['instagram'], { ...availability, instagramThread: false }),
    ).toBeNull();
    expect(pickReminderChannel(['facebook'], availability)).toBe('facebook');
    expect(
      pickReminderChannel(['facebook'], { ...availability, facebookThread: false }),
    ).toBeNull();
  });

  it('renders template placeholders', () => {
    const text = renderReminderMessage(
      'Hola {{nombre}}{{servicio}} el {{fecha}} a las {{hora}} en {{negocio}}',
      {
        nombre: 'Ana',
        servicio: reminderServiceClause('Corte'),
        fecha: 'sábado 22 de agosto',
        hora: '15:30',
        negocio: 'Novalup',
      },
    );
    expect(text).toBe(
      'Hola Ana de Corte el sábado 22 de agosto a las 15:30 en Novalup',
    );
  });

  it('normalizes phone and email', () => {
    expect(normalizeReminderPhone('+54 9 11 1234-5678')).toBe('5491112345678');
    expect(normalizeReminderPhone('123')).toBeNull();
    expect(normalizeReminderEmail('  Ana@Test.COM ')).toBe('ana@test.com');
    expect(normalizeReminderEmail('not-an-email')).toBeNull();
  });
});
