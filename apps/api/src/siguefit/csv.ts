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

const NAME_HINTS = ['cliente', 'nombre', 'alumno', 'alumna'];

/**
 * El export de "Turnos" de SigueFit trae 1-2 filas de metadata antes del
 * encabezado real (rango de fechas exportado, filtros). Buscamos la primera
 * fila que parezca un encabezado (tiene columna de fecha Y columna de
 * nombre) en vez de asumir que es la fila 0.
 */
function looksLikeHeaderRow(cells: string[]): boolean {
  const folded = cells.map(foldKey);
  const hasDate = folded.some((c) => c.includes('fecha'));
  const hasName = folded.some((c) =>
    NAME_HINTS.some((hint) => c.includes(hint)),
  );
  return hasDate && hasName;
}

export function toRecords(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const headerIdx = rows.findIndex(looksLikeHeaderRow);
  const headers = rows[headerIdx === -1 ? 0 : headerIdx].map(foldKey);
  return rows.slice((headerIdx === -1 ? 0 : headerIdx) + 1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((key, idx) => {
      record[key] = (cells[idx] ?? '').trim();
    });
    return record;
  });
}

/**
 * Los exports de SigueFit vienen en Windows-1252 (Excel en español), no
 * UTF-8. Decodificamos como UTF-8 y, si aparece el carácter de reemplazo
 * (bytes inválidos), volvemos a decodificar como latin1 — que coincide con
 * Windows-1252 para las letras acentuadas que usamos (á é í ó ú ñ).
 */
export function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}
