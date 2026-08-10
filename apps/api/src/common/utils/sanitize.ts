const SECRET_KEYS = [
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'webhookUrl',
  'webhook_url',
];

export function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, nested]) => {
        if (SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret.toLowerCase()))) {
          return [key, '[redacted]'];
        }
        return [key, sanitizeForLog(nested)];
      },
    );
    return Object.fromEntries(entries);
  }
  return value;
}

export function sanitizeToolResult(data: unknown): unknown {
  return sanitizeForLog(data);
}

export function stripUnsafeInstructions(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) =>
      /sql|bash|sh|powershell/i.test(block) ? '[bloque de código omitido]' : block,
    )
    .slice(0, 20_000);
}
