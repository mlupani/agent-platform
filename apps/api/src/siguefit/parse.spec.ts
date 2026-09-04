import {
  parsePackProgress,
  parseSpanishDate,
  parseClockTime,
  parseTurnoRows,
} from './parse';

describe('parsePackProgress', () => {
  it('reads "3/8" as taken 3 of a pack of 8', () => {
    expect(parsePackProgress('3/8')).toEqual({ taken: 3, size: 8 });
  });

  it('ignores trailing notes like "8/8 aca"', () => {
    expect(parsePackProgress('8/8 aca')).toEqual({ taken: 8, size: 8 });
  });

  it('tolerates spaces around the slash', () => {
    expect(parsePackProgress('3 / 4')).toEqual({ taken: 3, size: 4 });
  });

  it('returns null when there is no X/Y pattern', () => {
    expect(parsePackProgress('regalo')).toBeNull();
    expect(parsePackProgress('9')).toBeNull();
    expect(parsePackProgress('')).toBeNull();
  });

  it('clamps taken to the pack size', () => {
    expect(parsePackProgress('10/8')).toEqual({ taken: 8, size: 8 });
  });
});

describe('parseSpanishDate', () => {
  it('parses "01/Sep/2026"', () => {
    expect(parseSpanishDate('01/Sep/2026')).toEqual({
      year: 2026,
      month: 9,
      day: 1,
    });
  });

  it('is case-insensitive on the month abbreviation', () => {
    expect(parseSpanishDate('15/DIC/2025')).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });

  it('also accepts numeric dd/mm/yyyy and yyyy-mm-dd', () => {
    expect(parseSpanishDate('09/03/2026')).toEqual({
      year: 2026,
      month: 3,
      day: 9,
    });
    expect(parseSpanishDate('2026-09-03')).toEqual({
      year: 2026,
      month: 9,
      day: 3,
    });
  });

  it('returns null for junk', () => {
    expect(parseSpanishDate('manana')).toBeNull();
  });
});

describe('parseClockTime', () => {
  it('parses "9:00" and "17:30"', () => {
    expect(parseClockTime('9:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseClockTime('17:30')).toEqual({ hour: 17, minute: 30 });
  });

  it('returns null for out-of-range or junk', () => {
    expect(parseClockTime('25:00')).toBeNull();
    expect(parseClockTime('')).toBeNull();
  });
});

describe('parseTurnoRows', () => {
  const records = [
    {
      fecha: '01/Sep/2026',
      hora: '9:00',
      'nombre del cliente': 'Maria Laura Risi',
      observacion: '',
      comentarios: '3/8',
    },
    {
      fecha: '01/Sep/2026',
      hora: '10:00',
      'nombre del cliente': 'Ornela Faerverger',
      observacion: 'Ausente',
      comentarios: '8/8 aca',
    },
    {
      fecha: '',
      hora: '',
      'nombre del cliente': '',
      observacion: '',
      comentarios: '',
    },
  ];

  it('normalizes each usable row and drops empty ones', () => {
    const { rows } = parseTurnoRows(records);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rawName: 'Maria Laura Risi',
      date: { year: 2026, month: 9, day: 1 },
      time: { hour: 9, minute: 0 },
      progress: { taken: 3, size: 8 },
      absent: false,
      rawComment: '3/8',
    });
  });

  it('flags absence from the observation column', () => {
    const { rows } = parseTurnoRows(records);
    expect(rows[1].absent).toBe(true);
  });

  it('reports rows whose name is present but date is unreadable', () => {
    const { issues } = parseTurnoRows([
      {
        fecha: 'cuando pueda',
        hora: '9:00',
        'nombre del cliente': 'Ana',
        comentarios: '',
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Ana/);
  });
});
