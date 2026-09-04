/** Field-level parsing for SigueFit export rows. All pure, no I/O. */

export interface PackProgress {
  /** Classes already taken in the current pack (the "3" of "3/8"). */
  taken: number;
  /** Pack size (the "8" of "3/8"). */
  size: number;
}

export interface YMD {
  year: number;
  month: number;
  day: number;
}

export interface HM {
  hour: number;
  minute: number;
}

export interface TurnoRow {
  rawName: string;
  date: YMD | null;
  time: HM | null;
  progress: PackProgress | null;
  absent: boolean;
  rawComment: string;
}

export function parsePackProgress(comment: string): PackProgress | null {
  const match = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(comment ?? '');
  if (!match) return null;
  const size = Number(match[2]);
  const taken = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  return { taken: Math.max(0, Math.min(taken, size)), size };
}

const MONTHS: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

export function parseSpanishDate(value: string): YMD | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) {
    return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const named = /^(\d{1,2})[-/ ]([A-Za-zÁÉÍÓÚáéíóú]{3,})[-/ ](\d{2,4})$/.exec(
    raw,
  );
  if (named) {
    const key = named[2]
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .slice(0, 3);
    const month = MONTHS[key];
    if (!month) return null;
    return build(expandYear(Number(named[3])), month, Number(named[1]));
  }

  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(raw);
  if (numeric) {
    return build(
      expandYear(Number(numeric[3])),
      Number(numeric[2]),
      Number(numeric[1]),
    );
  }

  return null;
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function build(year: number, month: number, day: number): YMD | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function parseClockTime(value: string): HM | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

const pick = (record: Record<string, string>, ...keys: string[]): string => {
  for (const key of keys) {
    const hit = Object.keys(record).find((k) => k === key || k.includes(key));
    if (hit && record[hit]?.trim()) return record[hit].trim();
  }
  return '';
};

export function parseTurnoRows(records: Array<Record<string, string>>): {
  rows: TurnoRow[];
  issues: string[];
} {
  const rows: TurnoRow[] = [];
  const issues: string[] = [];

  for (const record of records) {
    const rawName = pick(
      record,
      'nombre del cliente',
      'cliente',
      'nombre',
      'alumno',
      'alumna',
    );
    if (!rawName) continue;

    const rawComment = pick(record, 'comentarios', 'comentario');
    const observation = pick(record, 'observacion', 'observaciones');
    const dateText = pick(record, 'fecha');
    const timeText = pick(record, 'hora');

    const date = parseSpanishDate(dateText);
    const time = parseClockTime(timeText);
    if (dateText && !date) {
      issues.push(`Fecha ilegible "${dateText}" para ${rawName}`);
    }
    if (timeText && !time) {
      issues.push(`Hora ilegible "${timeText}" para ${rawName}`);
    }

    const absent = /\bausente\b|\bno\s+(vino|asisti[oó])\b/i.test(
      `${observation} ${rawComment}`,
    );

    rows.push({
      rawName,
      date,
      time,
      progress: parsePackProgress(rawComment),
      absent,
      rawComment,
    });
  }

  return { rows, issues };
}
