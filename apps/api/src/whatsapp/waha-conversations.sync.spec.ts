import { WahaConversationsSyncService } from './waha-conversations.sync';

describe('WahaConversationsSyncService.messageContent', () => {
  const service = new WahaConversationsSyncService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const content = (item: unknown): string | null =>
    (
      service as unknown as { messageContent: (i: unknown) => string | null }
    ).messageContent(item);

  const VCARD = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Julieta Lujan Da Silva',
    'TEL;type=CELL;waid=5491164369670:+54 9 11 6436-9670',
    'END:VCARD',
  ].join('\n');

  it('plain text passes through', () => {
    expect(content({ body: 'hola, quiero un turno' })).toBe(
      'hola, quiero un turno',
    );
  });

  it('a raw vCard in body becomes the [Contacto] line, not the raw card', () => {
    expect(content({ body: VCARD })).toBe(
      '[Contacto] Julieta Lujan Da Silva · +54 9 11 6436-9670',
    );
  });

  it('a vCards array becomes the [Contacto] line', () => {
    expect(content({ body: '', vCards: [VCARD] })).toBe(
      '[Contacto] Julieta Lujan Da Silva · +54 9 11 6436-9670',
    );
  });
});
