const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  '429',
  '500',
  '502',
  '503',
  '504',
]);

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; status?: number; message?: string };
  if (err.code && TRANSIENT_CODES.has(String(err.code))) return true;
  if (err.status && TRANSIENT_CODES.has(String(err.status))) return true;
  const message = (err.message ?? '').toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('econnreset')
  );
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const minDelayMs = options.minDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 4000;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isTransientError(error)) {
        throw error;
      }
      const delay = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}
