/** Helpers para JIDs WAHA (WEBJS @c.us vs NOWEB @lid) y dedupe de conversaciones. */

export function phoneFromJid(jid?: string | null): string | null {
  if (!jid || typeof jid !== 'string') return null;
  if (jid.startsWith('0@')) return null;
  if (!/@(c\.us|s\.whatsapp\.net)$/i.test(jid)) return null;
  const phone = jid.replace(/@.+$/, '');
  return phone.length >= 8 ? phone : null;
}

/** Extrae dígitos de nombres tipo "+54 9 11 6289-7528". */
export function phoneFromDisplayName(name?: string | null): string | null {
  if (!name?.trim()) return null;
  const digits = name.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits;
}

export function alternateWhatsAppExternalIds(chatId: string): string[] {
  const ids = new Set<string>([chatId]);
  if (chatId.endsWith('@c.us')) {
    ids.add(chatId.replace(/@c\.us$/i, '@s.whatsapp.net'));
    ids.add(chatId.replace(/@c\.us$/i, ''));
  } else if (chatId.endsWith('@s.whatsapp.net')) {
    ids.add(chatId.replace(/@s\.whatsapp\.net$/i, '@c.us'));
    ids.add(chatId.replace(/@s\.whatsapp\.net$/i, ''));
  } else if (/^\d{8,}$/.test(chatId)) {
    ids.add(`${chatId}@c.us`);
    ids.add(`${chatId}@s.whatsapp.net`);
  }
  return [...ids];
}

export function phonesLikelySame(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 10) return false;
  return a.slice(-10) === b.slice(-10);
}

export function isWhatsAppLid(externalId?: string | null): boolean {
  return Boolean(externalId?.includes('@lid'));
}

export function isWhatsAppLegacyPhoneId(externalId?: string | null): boolean {
  return Boolean(
    externalId &&
    (/@c\.us$/i.test(externalId) || /@s\.whatsapp\.net$/i.test(externalId)),
  );
}

/**
 * Entre duplicados (@lid vs @c.us), preferir siempre el @lid de NOWEB.
 * No devolver un @c.us si existe un @lid candidato.
 */
export function pickPreferredWhatsAppConversation<
  T extends {
    id: string;
    externalId: string | null;
    hiddenAt: Date | null;
    updatedAt: Date;
  },
>(rows: T[], chatId: string): T | null {
  if (!rows.length) return null;
  const visible = rows.filter((r) => !r.hiddenAt);
  const pool = visible.length > 0 ? visible : rows;
  const lid = pool.find((r) => isWhatsAppLid(r.externalId));
  const exact = pool.find((r) => r.externalId === chatId);

  if (isWhatsAppLegacyPhoneId(chatId) && lid) return lid;
  if (isWhatsAppLid(chatId) && lid) return lid;
  if (exact) return exact;
  if (lid) return lid;
  return [...pool].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )[0];
}

/** No pisar un @lid activo con un @c.us del overview viejo. */
export function resolveWhatsAppExternalId(
  existingExternalId: string | null | undefined,
  incomingChatId: string,
): string {
  if (
    isWhatsAppLid(existingExternalId) &&
    isWhatsAppLegacyPhoneId(incomingChatId)
  ) {
    return existingExternalId as string;
  }
  return incomingChatId;
}
