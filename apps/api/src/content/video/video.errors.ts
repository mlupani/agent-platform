export class VideoProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VideoProviderUnavailableError';
  }
}

export class VideoGenerationFailedError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VideoGenerationFailedError';
  }
}

export function isRetryableVideoError(error: unknown): boolean {
  if (error instanceof VideoProviderUnavailableError) return true;

  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : NaN;
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error ?? '').toLowerCase();

  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;

  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('high demand') ||
    message.includes('capacity') ||
    message.includes('busy') ||
    message.includes('queue') ||
    message.includes('congest') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('temporar')
  );
}
