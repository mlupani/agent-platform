export interface JsonRequestOptions {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface JsonResponse<T> {
  status: number;
  json: T;
  text: string;
}

export async function requestJson<T = Record<string, unknown>>(
  options: JsonRequestOptions,
): Promise<JsonResponse<T>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = {} as T;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        json = {} as T;
      }
    }
    return { status: response.status, json, text };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error(`Timeout ${options.url}`), {
        status: 408,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadBinary(
  url: string,
  timeoutMs = 120_000,
  headers?: Record<string, string>,
): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`No se pudo descargar el video (${response.status})`),
        { status: response.status },
      );
    }
    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() ||
      'video/mp4';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error('El video descargado está vacío');
    }
    return { buffer, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
