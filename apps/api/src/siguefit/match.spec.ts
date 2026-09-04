import { normalizeName, matchStudents } from './match';

describe('normalizeName', () => {
  it('folds case, accents and repeated whitespace', () => {
    expect(normalizeName('  Ornela   Fáervergér ')).toBe('ornela faerverger');
  });

  it('drops punctuation', () => {
    expect(normalizeName('María-José (prueba)')).toBe('maria jose prueba');
  });
});

describe('matchStudents', () => {
  const users = [
    { id: 'u1', name: 'María Laura Risi' },
    { id: 'u2', name: 'Ana Gómez' },
    { id: 'u3', name: 'Ana Pérez' },
    { id: 'u4', name: 'Lucía Belén Maciel' },
  ];

  it('matches on an exact normalized name', () => {
    const res = matchStudents(['maria laura risi ', 'María Laura Risi'], users);
    expect(res.matched.get('maria laura risi ')).toBe('u1');
    expect(res.matched.get('María Laura Risi')).toBe('u1');
  });

  it('matches when the export drops a middle name', () => {
    const res = matchStudents(['Lucia Maciel'], users);
    expect(res.matched.get('Lucia Maciel')).toBe('u4');
  });

  it('does not guess when two students share first and last name', () => {
    const res = matchStudents(['Ana'], users);
    expect(res.matched.has('Ana')).toBe(false);
    const unmatched = res.unmatched.find((u) => u.rawName === 'Ana');
    expect(unmatched?.candidates).toEqual(
      expect.arrayContaining(['Ana Gómez', 'Ana Pérez']),
    );
  });

  it('reports a close candidate for a genuine miss', () => {
    const res = matchStudents(['Maria Laura Rissi'], users);
    const miss = res.unmatched.find((u) => u.rawName === 'Maria Laura Rissi');
    expect(miss?.candidates?.[0]).toBe('María Laura Risi');
  });

  it('deduplicates repeated raw names', () => {
    const res = matchStudents(['Ana Gómez', 'Ana Gómez'], users);
    expect(res.matched.size).toBe(1);
  });
});
