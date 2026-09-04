export const CONTACT_PREFIX = '[Contacto]';

export interface SharedContact {
  name: string | null;
  phones: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanPhone(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function nameFromVcardLines(lines: string[]): string | null {
  const fn = lines.find((l) => /^FN[:;]/i.test(l));
  if (fn) {
    const value = fn.slice(fn.indexOf(':') + 1).trim();
    if (value) return value;
  }
  const n = lines.find((l) => /^N[:;]/i.test(l));
  if (n) {
    const value = n.slice(n.indexOf(':') + 1).trim();
    // N:Apellido;Nombre;;; -> "Nombre Apellido"
    const [last = '', first = ''] = value.split(';');
    const joined = [first, last]
      .map((p) => p.trim())
      .filter(Boolean)
      .join(' ');
    if (joined) return joined;
  }
  return null;
}

function phonesFromVcardLines(lines: string[]): string[] {
  const phones: string[] = [];
  for (const line of lines) {
    if (!/^TEL[:;]/i.test(line)) continue;
    const value = line.slice(line.indexOf(':') + 1).trim();
    if (value) {
      phones.push(cleanPhone(value));
      continue;
    }
    const waid = /waid=(\d{6,})/i.exec(line);
    if (waid) phones.push(`+${waid[1]}`);
  }
  return phones;
}

function parseVcardString(vcard: string): SharedContact | null {
  if (!/BEGIN:VCARD/i.test(vcard)) return null;
  const lines = vcard
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const name = nameFromVcardLines(lines);
  const phones = [...new Set(phonesFromVcardLines(lines))];
  if (!name && phones.length === 0) return null;
  return { name, phones };
}

function mergeContacts(list: SharedContact[]): SharedContact | null {
  const merged = list.reduce<SharedContact>(
    (acc, cur) => ({
      name: acc.name ?? cur.name,
      phones: [...acc.phones, ...cur.phones],
    }),
    { name: null, phones: [] },
  );
  merged.phones = [...new Set(merged.phones)];
  if (!merged.name && merged.phones.length === 0) return null;
  return merged;
}

/**
 * Extrae nombre y teléfono(s) de una tarjeta de contacto compartida.
 * Acepta: string vCard, array de vCards, array de `{ vcard, displayName }`,
 * o un objeto `{ name/displayName, phone/phones/number }`.
 */
export function parseSharedContact(input: unknown): SharedContact | null {
  if (!input) return null;

  if (typeof input === 'string') {
    return parseVcardString(input);
  }

  if (Array.isArray(input)) {
    const parsed = input
      .map((item) => parseSharedContact(item))
      .filter((c): c is SharedContact => c !== null);
    return parsed.length ? mergeContacts(parsed) : null;
  }

  const record = asRecord(input);
  if (!record) return null;

  const vcard =
    stringOf(record.vcard) ?? stringOf(record.vCard) ?? stringOf(record.vcf);
  if (vcard) {
    const fromVcard = parseVcardString(vcard);
    const displayName = stringOf(record.displayName) ?? stringOf(record.name);
    if (fromVcard) {
      return {
        name: fromVcard.name ?? displayName ?? null,
        phones: fromVcard.phones,
      };
    }
    if (displayName) return { name: displayName, phones: [] };
    return null;
  }

  const name =
    stringOf(record.displayName) ??
    stringOf(record.name) ??
    stringOf(record.fullName) ??
    null;
  const rawPhones: string[] = [];
  if (Array.isArray(record.phones)) {
    for (const p of record.phones) {
      const value =
        stringOf(p) ??
        stringOf(asRecord(p)?.number) ??
        stringOf(asRecord(p)?.phone);
      if (value) rawPhones.push(cleanPhone(value));
    }
  }
  const single =
    stringOf(record.phone) ?? stringOf(record.number) ?? stringOf(record.tel);
  if (single) rawPhones.push(cleanPhone(single));

  const phones = [...new Set(rawPhones)];
  if (!name && phones.length === 0) return null;
  return { name, phones };
}

/**
 * Texto legible para el modelo a partir de un contacto compartido.
 * `[Contacto] Julieta Lujan Da Silva · +54 9 11 6436-9670`
 */
export function formatSharedContactMessage(
  contact: SharedContact | null,
  caption?: string | null,
): string {
  const cap = caption?.trim();
  const capPrefix = cap && cap !== CONTACT_PREFIX ? `${cap}\n` : '';

  if (!contact || (!contact.name && contact.phones.length === 0)) {
    return `${capPrefix}${CONTACT_PREFIX}`.trim();
  }

  const parts = [contact.name, contact.phones.join(', ')].filter(Boolean);
  return `${capPrefix}${CONTACT_PREFIX} ${parts.join(' · ')}`;
}

const CONTACT_TYPES = new Set([
  'vcard',
  'multi_vcard',
  'contact',
  'contacts',
  'contact_card',
]);

/** WAHA/WhatsApp: ¿el payload entrante es una tarjeta de contacto? */
export function isWahaContactPayload(payload: Record<string, unknown>): boolean {
  const data = asRecord(payload._data);
  const type = (stringOf(payload.type) ?? stringOf(data?.type) ?? '').toLowerCase();
  if (CONTACT_TYPES.has(type)) return true;

  const vcards =
    payload.vCards ?? payload.vcards ?? data?.vCards ?? data?.vcards;
  if (Array.isArray(vcards) && vcards.length > 0) return true;

  const body = stringOf(payload.body) ?? stringOf(data?.body);
  return Boolean(body && /^BEGIN:VCARD/i.test(body));
}

/** Fuente de vCards de un payload WAHA (string cruda o array). */
export function extractWahaVcards(payload: Record<string, unknown>): unknown {
  const data = asRecord(payload._data);
  const vcards =
    payload.vCards ?? payload.vcards ?? data?.vCards ?? data?.vcards;
  if (Array.isArray(vcards) && vcards.length > 0) return vcards;
  const body = stringOf(payload.body) ?? stringOf(data?.body);
  if (body && /BEGIN:VCARD/i.test(body)) return body;
  return null;
}

/** Instagram/Facebook (Zernio): ¿el attachment es una tarjeta de contacto? */
export function isContactAttachment(attachment: {
  type?: string;
  mimeType?: string;
}): boolean {
  const type = (attachment.type ?? '').toLowerCase();
  const mime = (attachment.mimeType ?? '').toLowerCase();
  if (CONTACT_TYPES.has(type)) return true;
  return (
    type.includes('contact') ||
    mime.includes('vcard') ||
    mime.includes('x-vcard')
  );
}
