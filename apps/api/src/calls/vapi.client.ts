import { Injectable } from '@nestjs/common';
import { withExponentialBackoff } from '../common/utils/retry';
import { withTimeout } from '../common/utils/timeout';
import type { VapiPhoneNumber } from './calls.types';

const VAPI_BASE = 'https://api.vapi.ai';

@Injectable()
export class VapiClient {
  async listPhoneNumbers(apiKey: string): Promise<VapiPhoneNumber[]> {
    const data = await this.request<
      Array<{ id: string; number?: string | null; name?: string | null; provider?: string }>
    >(apiKey, 'GET', '/phone-number');
    return (Array.isArray(data) ? data : []).map((item) => ({
      id: item.id,
      number: item.number ?? null,
      name: item.name ?? null,
      provider: item.provider ?? 'unknown',
    }));
  }

  getPhoneNumber(apiKey: string, id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(apiKey, 'GET', `/phone-number/${id}`);
  }

  async updatePhoneNumber(
    apiKey: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.request(apiKey, 'PATCH', `/phone-number/${id}`, patch);
  }

  private async request<T>(
    apiKey: string,
    method: 'GET' | 'PATCH' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return withExponentialBackoff(() =>
      withTimeout(async () => {
        const res = await fetch(`${VAPI_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const err = new Error(
            `Vapi ${method} ${path} respondió ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
          ) as Error & { status: number };
          err.status = res.status;
          throw err;
        }
        return (await res.json().catch(() => ({}))) as T;
      }, 15_000, `vapi ${method} ${path}`),
    );
  }
}
