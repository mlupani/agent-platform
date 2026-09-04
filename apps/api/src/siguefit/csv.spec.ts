import { parseDelimited, toRecords } from './csv';

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
});
