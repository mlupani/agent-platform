/**
 * Minimal delimited-text parser for the SigueFit "Exportar" file.
 * Handles quotes, doubled-quote escapes, embedded newlines, CRLF, and
 * auto-detects `,` vs `;` vs tab (Spanish Excel loves `;`).
 */

const DELIMITERS = [',', ';', '\t'] as const;

function detectDelimiter(text: string): string {
  const firstLine = text.slice(
    0,
    text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/),
  );
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // flush the last field/row if the file did not end with a newline
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // drop fully blank rows (trailing newlines, stray separators)
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const foldKey = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

export function toRecords(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const headers = rows[0].map(foldKey);
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((key, idx) => {
      record[key] = (cells[idx] ?? '').trim();
    });
    return record;
  });
}
