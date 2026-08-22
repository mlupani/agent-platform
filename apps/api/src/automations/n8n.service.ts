import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withTimeout } from '../common/utils/timeout';
import { withExponentialBackoff } from '../common/utils/retry';

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.timeoutMs = Number(
      this.config.get('N8N_WEBHOOK_TIMEOUT_MS') ?? 15_000,
    );
  }

  async triggerWebhook(
    url: string,
    payload: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const response = await withExponentialBackoff(() =>
      withTimeout(
        async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            body: JSON.stringify(payload),
          });
          const text = await res.text();
          if (!res.ok) {
            throw Object.assign(
              new Error(`n8n webhook failed: ${res.status}`),
              {
                status: res.status,
              },
            );
          }
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return { raw: text };
          }
        },
        this.timeoutMs,
        'n8n webhook',
      ),
    );

    this.logger.log('n8n webhook triggered');
    return response;
  }
}
