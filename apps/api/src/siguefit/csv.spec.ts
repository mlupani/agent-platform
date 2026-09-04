import { parseDelimited, toRecords, decodeCsv } from './csv';

describe('parseDelimited', () => {
  it('splits comma-separated rows into cells', () => {
    const text = 'a,b,c\n1,2,3\n';
    expect(parseDelimited(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas that live inside quoted fields', () => {
    const text = 'name,note\n"Perez, Ana","8/8, ok"\n';
    expect(parseDelimited(text)).toEqual([
      ['name', 'note'],
      ['Perez, Ana', '8/8, ok'],
    ]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const text = 'a\n"she said ""hi"""\n';
    expect(parseDelimited(text)).toEqual([['a'], ['she said "hi"']]);
  });

  it('auto-detects the semicolon delimiter used by Spanish Excel', () => {
    const text = 'a;b;c\n1;2;3\n';
    expect(parseDelimited(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF line endings and a newline inside a quoted field', () => {
    const text = 'a,b\r\n"line1\nline2",x\r\n';
    expect(parseDelimited(text)).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('ignores a trailing blank line', () => {
    expect(parseDelimited('a,b\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('toRecords', () => {
  it('maps rows onto accent-folded lowercase header keys', () => {
    const rows = [
      ['Fecha', 'Nombre del Cliente', 'Observación'],
      ['01/Sep/2026', 'Ana', 'Ausente'],
    ];
    expect(toRecords(rows)).toEqual([
      {
        fecha: '01/Sep/2026',
        'nombre del cliente': 'Ana',
        observacion: 'Ausente',
      },
    ]);
  });

  it('skips a metadata preamble before the real header row (SigueFit export)', () => {
    const rows = [
      ['Desde:', '01/09/2026', '', 'Hasta:', '30/09/2026', '', 'Todos'],
      ['Fecha', 'Hora', 'Cliente', 'Observaciones'],
      ['01/09/2026', '9', 'Lucia Maciel', '3/8'],
    ];
    expect(toRecords(rows)).toEqual([
      {
        fecha: '01/09/2026',
        hora: '9',
        cliente: 'Lucia Maciel',
        observaciones: '3/8',
      },
    ]);
  });
});

describe('decodeCsv', () => {
  it('decodes a plain utf8 buffer as-is', () => {
    expect(decodeCsv(Buffer.from('Día;Cliente\n', 'utf8'))).toBe(
      'Día;Cliente\n',
    );
  });

  it('falls back to latin1 when utf8 decoding produces replacement characters (SigueFit exports Windows-1252)', () => {
    const buf = Buffer.from('Día;Marcela Cuño\n', 'latin1');
    expect(decodeCsv(buf)).toBe('Día;Marcela Cuño\n');
  });
});
