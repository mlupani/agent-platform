import {
  restoreQuotedSpanish,
  restoreSpanishOrthography,
} from './spanish-orthography';

describe('spanish-orthography', () => {
  it('corrige palabras que siempre llevan tilde y respeta mayúsculas', () => {
    expect(restoreSpanishOrthography('este sabado tenes un dia facil')).toBe(
      'este sábado tenés un día fácil',
    );
    expect(restoreSpanishOrthography('DIA FACIL')).toBe('DÍA FÁCIL');
    expect(restoreSpanishOrthography('Tambien despues')).toBe(
      'También después',
    );
  });

  it('corrige -ción / -sión y superlativos', () => {
    expect(restoreSpanishOrthography('Ya sabes: atencion y promocion')).toBe(
      'Ya sabés: atención y promoción',
    );
    expect(restoreSpanishOrthography('promociones atenciones')).toBe(
      'promociones atenciones',
    );
    expect(restoreSpanishOrthography('television riquisimo')).toBe(
      'televisión riquísimo',
    );
    expect(restoreSpanishOrthography('PROMOCION')).toBe('PROMOCIÓN');
  });

  it('no toca palabras ambiguas ni las que ya tienen tilde', () => {
    expect(restoreSpanishOrthography('esta como que mas si el tu')).toBe(
      'esta como que mas si el tu',
    );
    expect(restoreSpanishOrthography('día también fácil')).toBe(
      'día también fácil',
    );
  });

  it('corrige solo el español entre comillas del videoPrompt', () => {
    expect(
      restoreQuotedSpanish(
        'Owner talking to camera saying "este sabado es un dia facil". slow action.',
      ),
    ).toBe(
      'Owner talking to camera saying "este sábado es un día fácil". slow action.',
    );
  });
});
