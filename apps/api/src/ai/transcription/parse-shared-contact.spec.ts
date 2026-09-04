import {
  parseSharedContact,
  formatSharedContactMessage,
  isWahaContactPayload,
  extractWahaVcards,
  isContactAttachment,
} from './parse-shared-contact';

const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Julieta Lujan Da Silva',
  'TEL;type=CELL;type=VOICE;waid=5491164369670:+54 9 11 6436-9670',
  'END:VCARD',
].join('\n');

describe('parseSharedContact', () => {
  it('extracts name and phone from a raw vCard string', () => {
    expect(parseSharedContact(VCARD)).toEqual({
      name: 'Julieta Lujan Da Silva',
      phones: ['+54 9 11 6436-9670'],
    });
  });

  it('extracts from an array of vCard strings', () => {
    expect(parseSharedContact([VCARD])).toEqual({
      name: 'Julieta Lujan Da Silva',
      phones: ['+54 9 11 6436-9670'],
    });
  });

  it('falls back to the waid digits when TEL has no visible value', () => {
    const v = ['BEGIN:VCARD', 'FN:Ana', 'TEL;waid=5491155551234:', 'END:VCARD'].join(
      '\n',
    );
    expect(parseSharedContact(v)).toEqual({
      name: 'Ana',
      phones: ['+5491155551234'],
    });
  });

  it('reconstructs the name from N when FN is missing', () => {
    const v = ['BEGIN:VCARD', 'N:Da Silva;Julieta;;;', 'TEL:+5491164369670', 'END:VCARD'].join(
      '\n',
    );
    expect(parseSharedContact(v)).toEqual({
      name: 'Julieta Da Silva',
      phones: ['+5491164369670'],
    });
  });

  it('parses a structured contact object', () => {
    expect(
      parseSharedContact({ displayName: 'Ana', phones: [{ number: '+5491155551234' }] }),
    ).toEqual({ name: 'Ana', phones: ['+5491155551234'] });
  });

  it('returns null for non-contact input', () => {
    expect(parseSharedContact('hola, quiero un turno')).toBeNull();
    expect(parseSharedContact(null)).toBeNull();
    expect(parseSharedContact(undefined)).toBeNull();
    expect(parseSharedContact([])).toBeNull();
  });
});

describe('formatSharedContactMessage', () => {
  it('formats a readable contact line', () => {
    expect(
      formatSharedContactMessage({
        name: 'Julieta Lujan Da Silva',
        phones: ['+54 9 11 6436-9670'],
      }),
    ).toBe('[Contacto] Julieta Lujan Da Silva · +54 9 11 6436-9670');
  });

  it('keeps a real caption before the contact line', () => {
    expect(
      formatSharedContactMessage(
        { name: 'Ana', phones: ['+5491155551234'] },
        'Te paso mis datos',
      ),
    ).toBe('Te paso mis datos\n[Contacto] Ana · +5491155551234');
  });

  it('joins multiple phones', () => {
    expect(
      formatSharedContactMessage({
        name: 'Ana',
        phones: ['+5491155551234', '+5491166667777'],
      }),
    ).toBe('[Contacto] Ana · +5491155551234, +5491166667777');
  });

  it('degrades to the bare placeholder when nothing could be parsed', () => {
    expect(formatSharedContactMessage(null)).toBe('[Contacto]');
    expect(formatSharedContactMessage({ name: null, phones: [] })).toBe('[Contacto]');
  });
});

describe('isWahaContactPayload / extractWahaVcards', () => {
  it('detects a vcard-typed payload', () => {
    expect(isWahaContactPayload({ type: 'vcard', body: VCARD })).toBe(true);
    expect(isWahaContactPayload({ type: 'multi_vcard', vCards: [VCARD] })).toBe(true);
  });

  it('detects a payload whose body is a raw vCard', () => {
    expect(isWahaContactPayload({ body: VCARD })).toBe(true);
  });

  it('is false for plain text and audio payloads', () => {
    expect(isWahaContactPayload({ body: 'hola' })).toBe(false);
    expect(isWahaContactPayload({ type: 'ptt', hasMedia: true })).toBe(false);
  });

  it('extracts the vCard source (array preferred, else body)', () => {
    expect(extractWahaVcards({ type: 'vcard', vCards: [VCARD] })).toEqual([VCARD]);
    expect(extractWahaVcards({ type: 'vcard', body: VCARD })).toBe(VCARD);
    expect(extractWahaVcards({ body: 'hola' })).toBeNull();
  });
});

describe('isContactAttachment', () => {
  it('detects Instagram/Facebook contact attachments', () => {
    expect(isContactAttachment({ type: 'contact' })).toBe(true);
    expect(isContactAttachment({ type: 'file', mimeType: 'text/vcard' })).toBe(true);
    expect(isContactAttachment({ type: 'image', mimeType: 'image/jpeg' })).toBe(false);
  });
});
