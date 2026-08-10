import { ChunkerService } from './chunker.service';

describe('ChunkerService', () => {
  const chunker = new ChunkerService();

  it('returns a single chunk when text is short', () => {
    expect(chunker.chunk('hola mundo', 100, 10)).toEqual(['hola mundo']);
  });

  it('splits long text with overlap', () => {
    const text = 'abcdefghij'.repeat(20);
    const chunks = chunker.chunk(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(50);
  });

  it('splits FAQ markdown by ## sections', () => {
    const faq = `# FAQ

## Horarios
Abrimos de 9 a 18.

## Contacto
Email hola@demo.test

## Servicios
Consulta y seguimiento.
`;
    const chunks = chunker.chunk(faq, 800, 120);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.includes('## Horarios'))).toBe(true);
    expect(chunks.some((c) => c.includes('## Contacto'))).toBe(true);
  });
});
