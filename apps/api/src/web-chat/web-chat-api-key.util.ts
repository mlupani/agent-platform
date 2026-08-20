import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_PREFIX = 'nlw_';

export function generateWidgetApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function widgetApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12);
}

export function hashWidgetApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function widgetApiKeysEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractWidgetApiKey(headers: {
  'x-api-key'?: string | string[];
  authorization?: string | string[];
}): string | null {
  const rawKey = headers['x-api-key'];
  const fromHeader = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (fromHeader?.trim()) return fromHeader.trim();

  const rawAuth = headers.authorization;
  const fromAuth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (!fromAuth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(fromAuth.trim());
  return match?.[1]?.trim() || null;
}

export function originAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}
