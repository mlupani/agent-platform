# Asistente de voz (llamadas entrantes) con Vapi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el asistente atienda llamadas telefónicas entrantes vía Vapi, reusando el Agent Core, con una integración en el admin para activarlo/desactivarlo.

**Architecture:** Vapi hace voz (STT/TTS/telefonía). El número de Vapi apunta su `server.url` a `POST /api/webhooks/vapi`; sin `assistantId`, cada llamada dispara `assistant-request`, al que respondemos un assistant **transitorio** con `model.provider: "custom-llm"` apuntando de vuelta a nuestro `POST /api/webhooks/vapi/chat/completions`. Ese bridge traduce cada turno OpenAI ↔ `AgentService.run({ channel: 'VOICE' })`, así tools/RAG/memoria/guardrails/observabilidad/bandeja se reusan sin duplicar nada.

**Tech Stack:** NestJS 11 + Prisma 6 (PostgreSQL) · `fetch` nativo (sin SDK de Vapi) · Zod · jest + ts-jest · Next.js (admin) + React Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-02-vapi-voice-calls-design.md`

## Global Constraints

- **Node 22+, pnpm 10+.** Comandos desde la raíz del monorepo salvo que se indique.
- **Tests de API:** `pnpm --filter api test` (jest, `testRegex: .*\.spec\.ts$`, `rootDir: src`). Un test puntual: `pnpm --filter api test -- <ruta-o-nombre>`.
- **Prisma:** cliente en `apps/api/src/common/prisma/prisma.service.ts` (`PrismaService`). Migrar: `pnpm --filter api prisma:migrate --name <nombre>` (necesita `pnpm docker:infra` levantado). Regenerar cliente: `pnpm --filter api prisma:generate`.
- **Global prefix de la API:** `api` (`app.setGlobalPrefix('api')`). Los `@Controller('webhooks/vapi')` quedan en `/api/webhooks/vapi`.
- **Secretos:** `SecretsService` (`apps/api/src/common/crypto/secrets.service.ts`) — `encrypt(plain): string` / `decrypt(payload): string`, AES-256-GCM con `ENCRYPTION_KEY`. Nunca loguear secretos, nunca mandarlos al front ni al LLM.
- **Auth admin:** `ApiKeyGuard` (`apps/api/src/common/guards/api-key.guard.ts`) en controllers `admin/*`. Los webhooks NO llevan guard (auth por header `x-vapi-secret`).
- **Validación de body:** `ZodValidationPipe` (`apps/api/src/common/pipes/zod-validation.pipe.ts`), patrón `@Body(new ZodValidationPipe(schema))`.
- **HTTP saliente:** `withTimeout(fn, ms, label)` y `withExponentialBackoff(fn, { retries, minDelayMs, maxDelayMs })` de `apps/api/src/common/utils/`.
- **Realtime:** `RealtimeEventsService` (`apps/api/src/realtime/realtime.events.service.ts`) — `conversationUpdated(businessId, payload)`, `conversationMessageCreated(businessId, payload)`, `emit(event, payload, businessId)`.
- **Idioma del código y de la copy:** español rioplatense, como el resto del repo.
- **Admin:** no hay jest. Verificación: `pnpm --filter admin lint` + `pnpm --filter admin build` + chequeo manual. Helper de fetch: `api<T>(path, init?)` de `apps/admin/src/lib/api.ts`.
- **Nombre del canal nuevo:** `VOICE` (mayúsculas), en `Conversation.channel` y `Lead.source`.
- **`model.url` de Vapi:** asumimos que Vapi le agrega `/chat/completions`. Si en pruebas resultara que la usa tal cual, poner el path completo en `buildTransientAssistant`. Documentado en la Task 12.

---

## File Structure

**API — módulo nuevo `apps/api/src/calls/`:**

| Archivo | Responsabilidad |
|---|---|
| `calls.module.ts` | Wiring del módulo. Imports: `AiModule`, `BusinessesModule`, `RealtimeModule`, `LeadsModule`, `PrismaModule`. Provee `SecretsService`. |
| `calls.types.ts` | `VapiCallPublicConfig`, `UpsertVapiCallInput`, `VapiPhoneNumber`, `VapiServerMessage`, tipos OpenAI mínimos. |
| `vapi.client.ts` | `VapiClient`: wrapper `fetch` de `api.vapi.ai` (`listPhoneNumbers`, `getPhoneNumber`, `updatePhoneNumber`). |
| `call-config.service.ts` | `CallConfigService`: config 1:1 por negocio (`getPublic`, `getForRuntime`, `upsert`, `setStatus`, `getApiKey`, `getWebhookSecret`, `resolveWebhookUrl`). |
| `call-log.service.ts` | `CallLogService`: crea/actualiza `CallLog` + cierra `Conversation` + realtime. |
| `vapi-bridge.service.ts` | `VapiBridgeService`: `POST /chat/completions` (OpenAI) → `AgentService.run` → SSE. |
| `vapi-webhook.service.ts` | `VapiWebhookService`: router de eventos Vapi, verificación de secret, `buildTransientAssistant`. |
| `calls-admin.controller.ts` | `@Controller('admin/calls')` + `ApiKeyGuard`. |
| `vapi-webhook.controller.ts` | `@Controller('webhooks/vapi')` + `@SkipThrottle()`. Dos handlers: eventos y `chat/completions`. |
| `*.spec.ts` | Tests unitarios por servicio. |

**API — modificados:**

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | `VapiCallConfig`, `CallLog`, relaciones inversas en `Business` y `Conversation`. |
| `apps/api/prisma/migrations/20260902120000_vapi_voice_calls/migration.sql` | Migración (autogenerada). |
| `apps/api/src/common/constants.ts` | `'VOICE'` en `channelTypes`. |
| `apps/api/src/ai/prompts/prompt.types.ts` | `channel?: string` en `AgentPromptContext`. |
| `apps/api/src/ai/prompts/prompt-builder.service.ts` | Bloque de prompt telefónico cuando `ctx.channel === 'VOICE'`. |
| `apps/api/src/ai/agents/agent.types.ts` | `maxStepsOverride?: number` en `AgentRunInput`. |
| `apps/api/src/ai/agents/agent.service.ts` | Pasar `channel` al `promptBuilder`; usar `maxStepsOverride`. |
| `apps/api/src/app.module.ts` | Importar `CallsModule`. |
| `.env.example` | Bloque `VAPI_API_KEY`. |
| `README.md` | Sección "Llamadas (Vapi)". |

**Admin — modificados/nuevos:**

| Archivo | Cambio |
|---|---|
| `apps/admin/src/components/vapi-call-config-form.tsx` | **Nuevo.** Form de la integración. |
| `apps/admin/src/components/integrations-hub.tsx` | Card "Llamadas" + panel `'calls'`. |
| `apps/admin/src/components/channel-icons.tsx` | Icono/label `VOICE`. |
| `apps/admin/src/components/conversations-inbox.tsx` | `VOICE` en el mapa de canales. |
| `apps/admin/src/components/dashboard-home.tsx` | `VOICE: 'Llamada'` en el label de canales. |
| `apps/admin/src/components/leads-list.tsx` | `VOICE` en `LeadChannel` + label + filtro. |

---

## Task 1: Schema Prisma + migración + canal VOICE

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260902120000_vapi_voice_calls/migration.sql` (autogenerada por prisma)
- Modify: `apps/api/src/common/constants.ts:25-33`
- Test: `apps/api/src/common/constants.spec.ts` (nuevo)

**Interfaces:**
- Produces: modelos Prisma `VapiCallConfig` (campos: `businessId @unique`, `vapiApiKeyEnc?`, `phoneNumberId?`, `phoneNumberE164?`, `voiceProvider="vapi"`, `voiceId="Elliot"`, `transcriberLanguage?`, `firstMessage?`, `webhookSecret?`, `enabled=false`, `agentEnabled=true`, `status="disconnected"`, `lastError?`, `lastSyncedAt?`) y `CallLog` (campos: `businessId`, `conversationId?`, `vapiCallId @unique`, `direction="inbound"`, `fromNumber?`, `toNumber?`, `status="ringing"`, `endedReason?`, `startedAt?`, `endedAt?`, `durationSeconds?`, `costUsd? Decimal(12,6)`, `transcript?`, `summary?`, `metadata? Json`). Constante `channelTypes` incluye `'VOICE'`.

- [ ] **Step 1: Agregar el canal VOICE + test**

En `apps/api/src/common/constants.ts`, agregar `'VOICE'` al array `channelTypes` (después de `'FACEBOOK'`):

```ts
export const channelTypes = [
  'WEB',
  'PLAYGROUND',
  'WHATSAPP',
  'TELEGRAM',
  'INSTAGRAM',
  'FACEBOOK',
  'VOICE',
] as const;
```

Crear `apps/api/src/common/constants.spec.ts`:

```ts
import { channelTypes } from './constants';

describe('constants', () => {
  it('incluye VOICE como canal de conversación', () => {
    expect(channelTypes).toContain('VOICE');
  });
});
```

- [ ] **Step 2: Correr el test**

Run: `pnpm --filter api test -- constants.spec`
Expected: PASS.

- [ ] **Step 3: Agregar los modelos al schema**

En `apps/api/prisma/schema.prisma`, dentro de `model Business { ... }` agregar al bloque de relaciones (junto a `whatsappConfig WhatsAppConfig?`):

```prisma
  vapiCallConfig       VapiCallConfig?
  callLogs             CallLog[]
```

Dentro de `model Conversation { ... }` agregar al bloque de relaciones (junto a `appointments Appointment[]`):

```prisma
  callLogs        CallLog[]
```

Al final del archivo, antes de `model AdminUser`, agregar los dos modelos nuevos (copiar textual de la sección 3 del spec `docs/superpowers/specs/2026-09-02-vapi-voice-calls-design.md`):

```prisma
/// Config del asistente de voz (Vapi) — una fila por negocio.
model VapiCallConfig {
  id                  String   @id @default(uuid())
  businessId          String   @unique
  business            Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  vapiApiKeyEnc       String?
  phoneNumberId       String?
  phoneNumberE164     String?
  voiceProvider       String   @default("vapi")
  voiceId             String   @default("Elliot")
  transcriberLanguage String?
  firstMessage        String?
  webhookSecret       String?
  enabled             Boolean  @default(false)
  agentEnabled        Boolean  @default(true)
  status              String   @default("disconnected")
  lastError           String?
  lastSyncedAt        DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@map("vapi_call_configs")
}

/// Registro de una llamada telefónica.
model CallLog {
  id              String        @id @default(uuid())
  businessId      String
  business        Business      @relation(fields: [businessId], references: [id], onDelete: Cascade)
  conversationId  String?
  conversation    Conversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  vapiCallId      String        @unique
  direction       String        @default("inbound")
  fromNumber      String?
  toNumber        String?
  status          String        @default("ringing")
  endedReason     String?
  startedAt       DateTime?
  endedAt         DateTime?
  durationSeconds Int?
  costUsd         Decimal?      @db.Decimal(12, 6)
  transcript      String?
  summary         String?
  metadata        Json?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([businessId, createdAt])
  @@map("call_logs")
}
```

- [ ] **Step 4: Generar y aplicar la migración**

Run:
```
pnpm docker:infra
pnpm --filter api prisma:migrate --name vapi_voice_calls
pnpm --filter api prisma:generate
```
Expected: crea `apps/api/prisma/migrations/20260902120000_vapi_voice_calls/` (el timestamp real lo pone prisma), aplica sin error, regenera el cliente. Verificar que el SQL crea `vapi_call_configs` y `call_logs`.

- [ ] **Step 5: Compilar para confirmar que el cliente Prisma tipa los modelos nuevos**

Run: `pnpm --filter api build`
Expected: PASS (sin errores de tipo).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/common/constants.ts apps/api/src/common/constants.spec.ts
git commit -m "feat(calls): schema VapiCallConfig + CallLog y canal VOICE"
```

---

## Task 2: VapiClient (wrapper HTTP de api.vapi.ai)

**Files:**
- Create: `apps/api/src/calls/vapi.client.ts`
- Create: `apps/api/src/calls/calls.types.ts`
- Test: `apps/api/src/calls/vapi.client.spec.ts`

**Interfaces:**
- Consumes: `withTimeout`, `withExponentialBackoff` de `../common/utils/`.
- Produces:
  - `interface VapiPhoneNumber { id: string; number: string | null; name: string | null; provider: string }`
  - `class VapiClient` (`@Injectable()`), métodos:
    - `listPhoneNumbers(apiKey: string): Promise<VapiPhoneNumber[]>`
    - `getPhoneNumber(apiKey: string, id: string): Promise<Record<string, unknown>>`
    - `updatePhoneNumber(apiKey: string, id: string, patch: Record<string, unknown>): Promise<void>`
  - Todos lanzan `Error` con mensaje legible si el status no es 2xx.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/src/calls/vapi.client.spec.ts`:

```ts
import { VapiClient } from './vapi.client';

describe('VapiClient', () => {
  const client = new VapiClient();
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('listPhoneNumbers mapea la respuesta de Vapi', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 'pn_1', number: '+5491100000000', name: 'Principal', provider: 'twilio' },
      ],
    });

    const result = await client.listPhoneNumbers('key');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vapi.ai/phone-number',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      }),
    );
    expect(result).toEqual([
      { id: 'pn_1', number: '+5491100000000', name: 'Principal', provider: 'twilio' },
    ]);
  });

  it('updatePhoneNumber hace PATCH con el body dado', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await client.updatePhoneNumber('key', 'pn_1', { assistantId: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vapi.ai/phone-number/pn_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ assistantId: null });
  });

  it('lanza error legible si Vapi responde no-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(client.listPhoneNumbers('bad')).rejects.toThrow(/Vapi.*401/);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter api test -- vapi.client.spec`
Expected: FAIL ("Cannot find module './vapi.client'").

- [ ] **Step 3: Implementar `calls.types.ts` (parte)**

Crear `apps/api/src/calls/calls.types.ts`:

```ts
export interface VapiPhoneNumber {
  id: string;
  number: string | null;
  name: string | null;
  provider: string;
}
```

- [ ] **Step 4: Implementar `VapiClient`**

Crear `apps/api/src/calls/vapi.client.ts`:

```ts
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
```

- [ ] **Step 5: Correr los tests**

Run: `pnpm --filter api test -- vapi.client.spec`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/calls/vapi.client.ts apps/api/src/calls/calls.types.ts apps/api/src/calls/vapi.client.spec.ts
git commit -m "feat(calls): VapiClient para phone-number API"
```

---

## Task 3: CallConfigService + tipos públicos

**Files:**
- Modify: `apps/api/src/calls/calls.types.ts`
- Create: `apps/api/src/calls/call-config.service.ts`
- Test: `apps/api/src/calls/call-config.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `SecretsService`, `BusinessesService` (`getCurrentId(): Promise<string>`), `ConfigService` (`get<string>(key)`), `VapiClient` (Task 2).
- Produces:
  - `interface VapiCallPublicConfig { businessId: string; hasApiKey: boolean; phoneNumberId: string | null; phoneNumberE164: string | null; voiceProvider: string; voiceId: string; transcriberLanguage: string | null; firstMessage: string | null; enabled: boolean; agentEnabled: boolean; status: string; lastError: string | null; lastSyncedAt: string | null; webhookUrl: string }`
  - `interface UpsertVapiCallInput { vapiApiKey?: string; phoneNumberId?: string | null; voiceProvider?: string; voiceId?: string; transcriberLanguage?: string | null; firstMessage?: string | null; enabled?: boolean; agentEnabled?: boolean }`
  - `class CallConfigService`:
    - `getPublic(): Promise<VapiCallPublicConfig | null>`
    - `getForRuntime(businessId?: string): Promise<VapiCallConfig | null>` (tipo Prisma)
    - `upsert(input: UpsertVapiCallInput): Promise<VapiCallPublicConfig>`
    - `syncPhoneNumber(): Promise<VapiCallPublicConfig>` (re-aplica server.url al número actual)
    - `setStatus(businessId: string, status: string, lastError?: string | null): Promise<void>`
    - `getApiKey(businessId?: string): Promise<string | null>` (desencripta o cae a `VAPI_API_KEY`)
    - `getWebhookSecret(businessId?: string): Promise<string | null>`
    - `resolveWebhookUrl(): string`
    - `listPhoneNumbers(): Promise<VapiPhoneNumber[]>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/calls/call-config.service.spec.ts`:

```ts
import { CallConfigService } from './call-config.service';

describe('CallConfigService', () => {
  const prisma = {
    vapiCallConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const secrets = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const env = {
    get: jest.fn((key: string) => {
      if (key === 'API_URL') return 'https://api.minegocio.com';
      return undefined;
    }),
  };
  const vapi = {
    listPhoneNumbers: jest.fn(),
    getPhoneNumber: jest.fn(),
    updatePhoneNumber: jest.fn(),
  };

  const service = new CallConfigService(
    prisma as never,
    secrets as never,
    businesses as never,
    env as never,
    vapi as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('getPublic nunca expone la API key ni el webhookSecret', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({
      businessId: 'biz-1',
      vapiApiKeyEnc: 'enc:secret',
      phoneNumberId: 'pn_1',
      phoneNumberE164: '+5491100000000',
      voiceProvider: 'vapi',
      voiceId: 'Elliot',
      transcriberLanguage: null,
      firstMessage: null,
      webhookSecret: 'ssh',
      enabled: true,
      agentEnabled: true,
      status: 'connected',
      lastError: null,
      lastSyncedAt: new Date('2026-09-02T10:00:00Z'),
    });

    const pub = await service.getPublic();

    expect(pub).toMatchObject({ hasApiKey: true, phoneNumberId: 'pn_1', enabled: true });
    expect(JSON.stringify(pub)).not.toContain('secret');
    expect(JSON.stringify(pub)).not.toContain('ssh');
    expect(pub?.webhookUrl).toBe('https://api.minegocio.com/api/webhooks/vapi');
  });

  it('upsert cifra la API key nueva y genera webhookSecret si falta', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue(null);
    prisma.vapiCallConfig.upsert.mockImplementation(async ({ create }: any) => ({
      ...create,
      lastSyncedAt: null,
    }));

    await service.upsert({ vapiApiKey: 'vapi-key-123', enabled: false });

    const call = prisma.vapiCallConfig.upsert.mock.calls[0][0];
    expect(call.create.vapiApiKeyEnc).toBe('enc:vapi-key-123');
    expect(typeof call.create.webhookSecret).toBe('string');
    expect(call.create.webhookSecret.length).toBeGreaterThan(16);
    // sin phoneNumberId → no toca Vapi
    expect(vapi.updatePhoneNumber).not.toHaveBeenCalled();
  });

  it('upsert con phoneNumberId apunta el server.url y limpia assistantId', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({
      businessId: 'biz-1',
      vapiApiKeyEnc: 'enc:k',
      webhookSecret: 'existing-secret',
      phoneNumberId: null,
      voiceProvider: 'vapi',
      voiceId: 'Elliot',
      enabled: false,
      agentEnabled: true,
    });
    prisma.vapiCallConfig.upsert.mockImplementation(async ({ update }: any) => ({
      businessId: 'biz-1',
      vapiApiKeyEnc: 'enc:k',
      webhookSecret: 'existing-secret',
      phoneNumberId: 'pn_9',
      phoneNumberE164: '+5491100000000',
      voiceProvider: 'vapi',
      voiceId: 'Elliot',
      transcriberLanguage: null,
      firstMessage: null,
      enabled: true,
      agentEnabled: true,
      status: 'connected',
      lastError: null,
      lastSyncedAt: new Date(),
      ...update,
    }));
    vapi.getPhoneNumber.mockResolvedValue({ id: 'pn_9', provider: 'twilio', number: '+5491100000000' });
    vapi.updatePhoneNumber.mockResolvedValue(undefined);

    await service.upsert({ phoneNumberId: 'pn_9', enabled: true });

    expect(vapi.updatePhoneNumber).toHaveBeenCalledWith(
      'k',
      'pn_9',
      expect.objectContaining({
        assistantId: null,
        squadId: null,
        server: {
          url: 'https://api.minegocio.com/api/webhooks/vapi',
          secret: 'existing-secret',
        },
      }),
    );
  });

  it('upsert no rompe el guardado si Vapi falla; deja status error', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({
      businessId: 'biz-1', vapiApiKeyEnc: 'enc:k', webhookSecret: 's',
      voiceProvider: 'vapi', voiceId: 'Elliot', enabled: false, agentEnabled: true,
    });
    prisma.vapiCallConfig.upsert.mockImplementation(async () => ({
      businessId: 'biz-1', vapiApiKeyEnc: 'enc:k', webhookSecret: 's',
      phoneNumberId: 'pn_9', phoneNumberE164: null, voiceProvider: 'vapi', voiceId: 'Elliot',
      transcriberLanguage: null, firstMessage: null, enabled: true, agentEnabled: true,
      status: 'connected', lastError: null, lastSyncedAt: null,
    }));
    vapi.getPhoneNumber.mockRejectedValue(new Error('boom'));

    const pub = await service.upsert({ phoneNumberId: 'pn_9', enabled: true });

    expect(pub.status).toBe('error');
    expect(pub.lastError).toContain('boom');
    expect(prisma.vapiCallConfig.updateMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1' },
      data: { status: 'error', lastError: expect.stringContaining('boom') },
    });
  });

  it('getApiKey cae a env VAPI_API_KEY si no hay una guardada', async () => {
    prisma.vapiCallConfig.findUnique.mockResolvedValue({ businessId: 'biz-1', vapiApiKeyEnc: null });
    env.get.mockImplementation((k: string) => (k === 'VAPI_API_KEY' ? 'env-key' : undefined));

    expect(await service.getApiKey()).toBe('env-key');
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm --filter api test -- call-config.service.spec`
Expected: FAIL ("Cannot find module './call-config.service'").

- [ ] **Step 3: Extender `calls.types.ts`**

Agregar a `apps/api/src/calls/calls.types.ts`:

```ts
export interface VapiCallPublicConfig {
  businessId: string;
  hasApiKey: boolean;
  phoneNumberId: string | null;
  phoneNumberE164: string | null;
  voiceProvider: string;
  voiceId: string;
  transcriberLanguage: string | null;
  firstMessage: string | null;
  enabled: boolean;
  agentEnabled: boolean;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  webhookUrl: string;
}

export interface UpsertVapiCallInput {
  vapiApiKey?: string;
  phoneNumberId?: string | null;
  voiceProvider?: string;
  voiceId?: string;
  transcriberLanguage?: string | null;
  firstMessage?: string | null;
  enabled?: boolean;
  agentEnabled?: boolean;
}
```

- [ ] **Step 4: Implementar `CallConfigService`**

Crear `apps/api/src/calls/call-config.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { VapiCallConfig } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';
import { BusinessesService } from '../businesses/businesses.service';
import { VapiClient } from './vapi.client';
import type {
  UpsertVapiCallInput,
  VapiCallPublicConfig,
  VapiPhoneNumber,
} from './calls.types';

@Injectable()
export class CallConfigService {
  private readonly logger = new Logger(CallConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly businesses: BusinessesService,
    private readonly env: ConfigService,
    private readonly vapi: VapiClient,
  ) {}

  resolveWebhookUrl(): string {
    const base =
      this.env.get<string>('API_URL') ??
      this.env.get<string>('NEXT_PUBLIC_API_URL')?.replace(/\/api\/?$/, '') ??
      'http://localhost:3001';
    return `${base.replace(/\/$/, '')}/api/webhooks/vapi`;
  }

  async getForRuntime(businessId?: string): Promise<VapiCallConfig | null> {
    const id = businessId ?? (await this.businesses.getCurrentId());
    return this.prisma.vapiCallConfig.findUnique({ where: { businessId: id } });
  }

  async getApiKey(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    if (config?.vapiApiKeyEnc) return this.secrets.decrypt(config.vapiApiKeyEnc);
    return this.env.get<string>('VAPI_API_KEY') ?? null;
  }

  async getWebhookSecret(businessId?: string): Promise<string | null> {
    const config = await this.getForRuntime(businessId);
    return config?.webhookSecret ?? null;
  }

  async getPublic(): Promise<VapiCallPublicConfig | null> {
    const businessId = await this.businesses.getCurrentId();
    const config = await this.prisma.vapiCallConfig.findUnique({ where: { businessId } });
    if (!config) return null;
    return this.toPublic(config);
  }

  async listPhoneNumbers(): Promise<VapiPhoneNumber[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Falta la API key de Vapi');
    return this.vapi.listPhoneNumbers(apiKey);
  }

  async setStatus(businessId: string, status: string, lastError?: string | null): Promise<void> {
    await this.prisma.vapiCallConfig.updateMany({
      where: { businessId },
      data: { status, lastError: lastError ?? null },
    });
  }

  async upsert(input: UpsertVapiCallInput): Promise<VapiCallPublicConfig> {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.vapiCallConfig.findUnique({ where: { businessId } });

    const vapiApiKeyEnc = input.vapiApiKey
      ? this.secrets.encrypt(input.vapiApiKey)
      : existing?.vapiApiKeyEnc ?? null;
    const webhookSecret = existing?.webhookSecret ?? randomBytes(24).toString('hex');
    const phoneNumberId =
      input.phoneNumberId === undefined ? existing?.phoneNumberId ?? null : input.phoneNumberId;

    const data = {
      vapiApiKeyEnc,
      webhookSecret,
      phoneNumberId,
      voiceProvider: input.voiceProvider ?? existing?.voiceProvider ?? 'vapi',
      voiceId: input.voiceId ?? existing?.voiceId ?? 'Elliot',
      transcriberLanguage:
        input.transcriberLanguage === undefined
          ? existing?.transcriberLanguage ?? null
          : input.transcriberLanguage || null,
      firstMessage:
        input.firstMessage === undefined
          ? existing?.firstMessage ?? null
          : input.firstMessage || null,
      enabled: input.enabled ?? existing?.enabled ?? false,
      agentEnabled: input.agentEnabled ?? existing?.agentEnabled ?? true,
    };

    let config = await this.prisma.vapiCallConfig.upsert({
      where: { businessId },
      create: { businessId, status: 'disconnected', ...data },
      update: { ...data },
    });

    if (phoneNumberId && vapiApiKeyEnc) {
      config = await this.applyServerUrl(businessId, config);
    }

    return this.toPublic(config);
  }

  async syncPhoneNumber(): Promise<VapiCallPublicConfig> {
    const businessId = await this.businesses.getCurrentId();
    const config = await this.prisma.vapiCallConfig.findUnique({ where: { businessId } });
    if (!config?.phoneNumberId) throw new Error('No hay número configurado');
    const updated = await this.applyServerUrl(businessId, config);
    return this.toPublic(updated);
  }

  private async applyServerUrl(
    businessId: string,
    config: VapiCallConfig,
  ): Promise<VapiCallConfig> {
    try {
      const apiKey = await this.getApiKey(businessId);
      if (!apiKey) throw new Error('Falta la API key de Vapi');
      const remote = await this.vapi.getPhoneNumber(apiKey, config.phoneNumberId!);
      await this.vapi.updatePhoneNumber(apiKey, config.phoneNumberId!, {
        assistantId: null,
        squadId: null,
        server: { url: this.resolveWebhookUrl(), secret: config.webhookSecret },
      });
      return this.prisma.vapiCallConfig.update({
        where: { businessId },
        data: {
          status: 'connected',
          lastError: null,
          lastSyncedAt: new Date(),
          phoneNumberE164:
            typeof remote.number === 'string' ? remote.number : config.phoneNumberE164,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error apuntando el número en Vapi';
      this.logger.warn(`applyServerUrl falló: ${message}`);
      await this.setStatus(businessId, 'error', message);
      return this.prisma.vapiCallConfig.findUniqueOrThrow({ where: { businessId } });
    }
  }

  private toPublic(config: VapiCallConfig): VapiCallPublicConfig {
    return {
      businessId: config.businessId,
      hasApiKey: Boolean(config.vapiApiKeyEnc || this.env.get<string>('VAPI_API_KEY')),
      phoneNumberId: config.phoneNumberId,
      phoneNumberE164: config.phoneNumberE164,
      voiceProvider: config.voiceProvider,
      voiceId: config.voiceId,
      transcriberLanguage: config.transcriberLanguage,
      firstMessage: config.firstMessage,
      enabled: config.enabled,
      agentEnabled: config.agentEnabled,
      status: config.status,
      lastError: config.lastError,
      lastSyncedAt: config.lastSyncedAt ? config.lastSyncedAt.toISOString() : null,
      webhookUrl: this.resolveWebhookUrl(),
    };
  }
}
```

- [ ] **Step 5: Correr los tests**

Run: `pnpm --filter api test -- call-config.service.spec`
Expected: PASS (5 tests). Ajustar mocks si algún nombre de campo difiere.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/calls/call-config.service.ts apps/api/src/calls/calls.types.ts apps/api/src/calls/call-config.service.spec.ts
git commit -m "feat(calls): CallConfigService (config 1:1, cifrado, server URL de Vapi)"
```

---

## Task 4: Módulo `CallsModule` + `CallsAdminController`

**Files:**
- Create: `apps/api/src/calls/calls.module.ts`
- Create: `apps/api/src/calls/calls-admin.controller.ts`
- Modify: `apps/api/src/app.module.ts:31-87`
- Test: `apps/api/src/calls/calls-admin.controller.spec.ts`

**Interfaces:**
- Consumes: `CallConfigService` (Task 3), `ApiKeyGuard`, `ZodValidationPipe`.
- Produces: rutas HTTP —
  - `GET /api/admin/calls` → `VapiCallPublicConfig | null`
  - `PUT /api/admin/calls` → `VapiCallPublicConfig` (body `UpsertVapiCallInput`)
  - `GET /api/admin/calls/phone-numbers` → `VapiPhoneNumber[]`
  - `POST /api/admin/calls/sync` → `VapiCallPublicConfig`
  - `GET /api/admin/calls/logs?limit=` → `CallLog[]`
  - `CallsModule` exportando `CallConfigService`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/src/calls/calls-admin.controller.spec.ts`:

```ts
import { CallsAdminController } from './calls-admin.controller';

describe('CallsAdminController', () => {
  const configService = {
    getPublic: jest.fn(),
    upsert: jest.fn(),
    listPhoneNumbers: jest.fn(),
    syncPhoneNumber: jest.fn(),
  };
  const prisma = { callLog: { findMany: jest.fn() } };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const controller = new CallsAdminController(
    configService as never,
    prisma as never,
    businesses as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('GET /admin/calls devuelve la config pública', async () => {
    configService.getPublic.mockResolvedValue({ enabled: true });
    expect(await controller.get()).toEqual({ enabled: true });
  });

  it('PUT /admin/calls valida y delega en upsert', async () => {
    configService.upsert.mockResolvedValue({ enabled: false });
    const result = await controller.upsert({ enabled: false, transcriberLanguage: '' });
    expect(configService.upsert).toHaveBeenCalledWith({ enabled: false, transcriberLanguage: '' });
    expect(result).toEqual({ enabled: false });
  });

  it('GET /admin/calls/logs limita y filtra por negocio', async () => {
    prisma.callLog.findMany.mockResolvedValue([{ id: 'c1' }]);
    await controller.logs('5');
    expect(prisma.callLog.findMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter api test -- calls-admin.controller.spec`
Expected: FAIL ("Cannot find module './calls-admin.controller'").

- [ ] **Step 3: Implementar el controller**

Crear `apps/api/src/calls/calls-admin.controller.ts`:

```ts
import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { CallConfigService } from './call-config.service';

const upsertSchema = z.object({
  vapiApiKey: z.string().min(8).optional(),
  phoneNumberId: z.string().min(1).nullable().optional(),
  voiceProvider: z.string().min(1).optional(),
  voiceId: z.string().min(1).optional(),
  transcriberLanguage: z.string().max(10).nullable().optional(),
  firstMessage: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  agentEnabled: z.boolean().optional(),
});

@Controller('admin/calls')
@UseGuards(ApiKeyGuard)
export class CallsAdminController {
  constructor(
    private readonly config: CallConfigService,
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get()
  get() {
    return this.config.getPublic();
  }

  @Put()
  upsert(
    @Body(new ZodValidationPipe(upsertSchema)) body: z.infer<typeof upsertSchema>,
  ) {
    return this.config.upsert(body);
  }

  @Get('phone-numbers')
  phoneNumbers() {
    return this.config.listPhoneNumbers();
  }

  @Post('sync')
  sync() {
    return this.config.syncPhoneNumber();
  }

  @Get('logs')
  async logs(@Query('limit') limit?: string) {
    const businessId = await this.businesses.getCurrentId();
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.prisma.callLog.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
```

- [ ] **Step 4: Implementar el módulo (sin webhook todavía)**

Crear `apps/api/src/calls/calls.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { LeadsModule } from '../leads/leads.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { SecretsService } from '../common/crypto/secrets.service';
import { VapiClient } from './vapi.client';
import { CallConfigService } from './call-config.service';
import { CallsAdminController } from './calls-admin.controller';

@Module({
  imports: [PrismaModule, BusinessesModule, RealtimeModule, AiModule, LeadsModule],
  controllers: [CallsAdminController],
  providers: [SecretsService, VapiClient, CallConfigService],
  exports: [CallConfigService],
})
export class CallsModule {}
```

- [ ] **Step 5: Registrar en `app.module.ts`**

En `apps/api/src/app.module.ts`: agregar `import { CallsModule } from './calls/calls.module';` con los otros imports, y `CallsModule,` al array `imports` (después de `VoiceModule,`).

- [ ] **Step 6: Correr tests + build**

Run: `pnpm --filter api test -- calls-admin.controller.spec && pnpm --filter api build`
Expected: PASS + build sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/calls/calls.module.ts apps/api/src/calls/calls-admin.controller.ts apps/api/src/calls/calls-admin.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat(calls): CallsModule + endpoints admin/calls"
```

---

## Task 5: Prompt telefónico + overrides del agente

**Files:**
- Modify: `apps/api/src/ai/prompts/prompt.types.ts:30-54`
- Modify: `apps/api/src/ai/prompts/prompt-builder.service.ts:37-66` (+ nuevo método privado)
- Modify: `apps/api/src/ai/agents/agent.types.ts:5-15`
- Modify: `apps/api/src/ai/agents/agent.service.ts` (paso de `channel`; uso de `maxStepsOverride`)
- Test: `apps/api/src/ai/prompts/prompt-builder.service.spec.ts` (crear si no existe, o agregar `describe`)

**Interfaces:**
- Produces:
  - `AgentPromptContext.channel?: string`
  - `AgentRunInput.maxStepsOverride?: number`
  - `PromptBuilderService.buildFromContext(ctx)` agrega el bloque VOICE cuando `ctx.channel === 'VOICE'`.
  - `AgentService.run` usa `input.maxStepsOverride ?? agentConfig.maxSteps` como tope del loop y pasa `channel: input.channel` al builder.

- [ ] **Step 1: Escribir el test que falla**

En `apps/api/src/ai/prompts/prompt-builder.service.spec.ts` (crear si no existe; imports mínimos ya usados por otros specs del repo), agregar:

```ts
import { PromptBuilderService } from './prompt-builder.service';
import { DEFAULT_CONFIGURED_MESSAGES } from '../../common/constants';

describe('PromptBuilderService — canal VOICE', () => {
  const service = new PromptBuilderService();
  const baseCtx = {
    assistantName: 'Asis',
    tone: 'professional_warm',
    business: { name: 'Pilates X', description: null, type: 'GYM', timezone: 'America/Argentina/Buenos_Aires', language: 'es' },
    hoursText: '',
    servicesText: '',
    configuredMessages: DEFAULT_CONFIGURED_MESSAGES,
    enabledTools: [],
  } as never;

  it('sin channel el prompt no menciona la llamada', () => {
    const prompt = service.buildFromContext(baseCtx);
    expect(prompt).not.toMatch(/llamada telef/i);
  });

  it('channel VOICE agrega guía de conversación hablada', () => {
    const prompt = service.buildFromContext({ ...(baseCtx as object), channel: 'VOICE' } as never);
    expect(prompt).toMatch(/llamada telef/i);
    expect(prompt).toMatch(/breves/i);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter api test -- prompt-builder.service.spec`
Expected: FAIL (el segundo test: no encuentra "llamada telef").

- [ ] **Step 3: Agregar `channel` al tipo**

En `apps/api/src/ai/prompts/prompt.types.ts`, dentro de `interface AgentPromptContext`, agregar después de `studentContext?: string | null;`:

```ts
  /** Canal de la conversación (WEB | WHATSAPP | VOICE | ...). Ajusta guías de formato. */
  channel?: string;
```

- [ ] **Step 4: Agregar el bloque VOICE al builder**

En `apps/api/src/ai/prompts/prompt-builder.service.ts`, dentro de `buildFromContext`, agregar al array `sections` (justo después de `this.behaviorSection(ctx),`):

```ts
      this.channelSection(ctx),
```

Y agregar el método privado (cerca de `behaviorSection`):

```ts
  private channelSection(ctx: AgentPromptContext): string | null {
    if (ctx.channel !== 'VOICE') return null;
    return [
      'Estás en una llamada telefónica.',
      'Respuestas breves y habladas: 1 a 3 frases, una sola pregunta por vez.',
      'Decí números, horarios y montos en palabras ("las tres y media", "quince mil pesos").',
      'Nada de listas, viñetas, markdown ni emojis.',
      'Si tenés que buscar algo (disponibilidad, datos), avisá "dame un momento" antes.',
      'Para cortar, despedite y usá la herramienta de fin de llamada.',
    ].join(' ');
  }
```

- [ ] **Step 5: Correr el test del prompt**

Run: `pnpm --filter api test -- prompt-builder.service.spec`
Expected: PASS.

- [ ] **Step 6: `maxStepsOverride` en `AgentRunInput` + uso en `run`**

En `apps/api/src/ai/agents/agent.types.ts`, dentro de `interface AgentRunInput` agregar:

```ts
  /** Tope de pasos del loop para este run (voz usa un valor más bajo por latencia). */
  maxStepsOverride?: number;
```

En `apps/api/src/ai/agents/agent.service.ts`:
- Donde se arma el `while (steps < agentConfig.maxSteps)` (y el log de `[AGENT 6/6] llm loop start maxSteps=...`), introducir una const antes del loop:
  ```ts
  const maxSteps = Math.max(1, input.maxStepsOverride ?? agentConfig.maxSteps);
  ```
  y reemplazar `agentConfig.maxSteps` por `maxSteps` en la condición del `while` y en el log.
- En la llamada a `this.promptBuilder.buildFromContext({ ... })`, agregar la propiedad:
  ```ts
      channel: input.channel,
  ```

- [ ] **Step 7: Test del override de pasos**

En `apps/api/src/ai/agents/agent.service.spec.ts` (si existe; si no, crear un `describe` mínimo siguiendo el patrón de otros specs con mocks), agregar un test que verifique que con `maxStepsOverride: 1` el loop corre una sola vez. Si montar el `AgentService` completo es demasiado, dejar este test como TODO explícito NO — en su lugar, agregar el chequeo al test de `vapi-bridge.service.spec` (Task 7) verificando que el bridge pasa `maxStepsOverride`.

Nota para el implementador: si `agent.service.spec.ts` no existe o su setup es pesado, SALTAR este step y cubrir el override en Task 7 (el bridge pasa `maxStepsOverride: 4` y el spec del bridge lo verifica). No agregar un spec nuevo de `AgentService` solo para esto.

- [ ] **Step 8: Correr toda la suite de `ai/`**

Run: `pnpm --filter api test -- ai/`
Expected: PASS (sin regresiones).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/ai/prompts apps/api/src/ai/agents
git commit -m "feat(ai): guía de prompt para canal VOICE + maxStepsOverride"
```

---

## Task 6: CallLogService

**Files:**
- Create: `apps/api/src/calls/call-log.service.ts`
- Modify: `apps/api/src/calls/calls.module.ts` (agregar provider)
- Test: `apps/api/src/calls/call-log.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `RealtimeEventsService`.
- Produces `class CallLogService`:
  - `startInboundCall(params: { businessId: string; vapiCallId: string; conversationId: string; fromNumber?: string | null; toNumber?: string | null }): Promise<void>` — upsert por `vapiCallId` (idempotente).
  - `updateStatus(vapiCallId: string, status: string): Promise<void>` — mapea `in-progress|ended` y actualiza `startedAt`/`endedAt`.
  - `finalizeFromReport(params: { vapiCallId: string; endedReason?: string; startedAt?: string; endedAt?: string; costUsd?: number; transcript?: string; summary?: string }): Promise<void>` — completa el `CallLog` y cierra la `Conversation` (`status: 'CLOSED'`, `summary`).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/calls/call-log.service.spec.ts`:

```ts
import { CallLogService } from './call-log.service';

describe('CallLogService', () => {
  const prisma = {
    callLog: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    conversation: { update: jest.fn() },
  };
  const realtime = { conversationUpdated: jest.fn() };
  const service = new CallLogService(prisma as never, realtime as never);

  beforeEach(() => jest.clearAllMocks());

  it('startInboundCall es idempotente (upsert por vapiCallId)', async () => {
    await service.startInboundCall({
      businessId: 'biz-1', vapiCallId: 'call_1', conversationId: 'conv_1',
      fromNumber: '+549110', toNumber: '+549111',
    });
    const arg = prisma.callLog.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ vapiCallId: 'call_1' });
    expect(arg.create).toMatchObject({
      businessId: 'biz-1', conversationId: 'conv_1', vapiCallId: 'call_1',
      direction: 'inbound', status: 'ringing', fromNumber: '+549110',
    });
  });

  it('updateStatus mapea ended y setea endedAt', async () => {
    await service.updateStatus('call_1', 'ended');
    const arg = prisma.callLog.update.mock.calls[0][0];
    expect(arg.where).toEqual({ vapiCallId: 'call_1' });
    expect(arg.data.status).toBe('ended');
    expect(arg.data.endedAt).toBeInstanceOf(Date);
  });

  it('finalizeFromReport completa el log y cierra la conversación', async () => {
    prisma.callLog.update.mockResolvedValue({
      id: 'cl_1', businessId: 'biz-1', conversationId: 'conv_1', vapiCallId: 'call_1',
    });
    await service.finalizeFromReport({
      vapiCallId: 'call_1',
      endedReason: 'customer-ended-call',
      startedAt: '2026-09-02T10:00:00Z',
      endedAt: '2026-09-02T10:03:00Z',
      costUsd: 0.12,
      transcript: 'hola...',
      summary: 'El cliente pidió un turno.',
    });
    const logArg = prisma.callLog.update.mock.calls[0][0];
    expect(logArg.data).toMatchObject({
      endedReason: 'customer-ended-call', costUsd: 0.12,
      transcript: 'hola...', summary: 'El cliente pidió un turno.', durationSeconds: 180,
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: expect.objectContaining({ status: 'CLOSED', summary: 'El cliente pidió un turno.' }),
    });
    expect(realtime.conversationUpdated).toHaveBeenCalledWith('biz-1', expect.objectContaining({ conversationId: 'conv_1' }));
  });

  it('finalizeFromReport tolera call desconocida sin romper', async () => {
    prisma.callLog.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    await expect(service.finalizeFromReport({ vapiCallId: 'ghost' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm --filter api test -- call-log.service.spec`
Expected: FAIL ("Cannot find module './call-log.service'").

- [ ] **Step 3: Implementar `CallLogService`**

Crear `apps/api/src/calls/call-log.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';

@Injectable()
export class CallLogService {
  private readonly logger = new Logger(CallLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  async startInboundCall(params: {
    businessId: string;
    vapiCallId: string;
    conversationId: string;
    fromNumber?: string | null;
    toNumber?: string | null;
  }): Promise<void> {
    await this.prisma.callLog.upsert({
      where: { vapiCallId: params.vapiCallId },
      create: {
        businessId: params.businessId,
        conversationId: params.conversationId,
        vapiCallId: params.vapiCallId,
        direction: 'inbound',
        status: 'ringing',
        fromNumber: params.fromNumber ?? null,
        toNumber: params.toNumber ?? null,
      },
      update: { conversationId: params.conversationId },
    });
  }

  async updateStatus(vapiCallId: string, status: string): Promise<void> {
    const normalized =
      status === 'in-progress' ? 'in-progress' : status === 'ended' ? 'ended' : status;
    try {
      await this.prisma.callLog.update({
        where: { vapiCallId },
        data: {
          status: normalized,
          ...(normalized === 'in-progress' ? { startedAt: new Date() } : {}),
          ...(normalized === 'ended' ? { endedAt: new Date() } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(`updateStatus(${vapiCallId}) ignorado: ${(error as Error).message}`);
    }
  }

  async finalizeFromReport(params: {
    vapiCallId: string;
    endedReason?: string;
    startedAt?: string;
    endedAt?: string;
    costUsd?: number;
    transcript?: string;
    summary?: string;
  }): Promise<void> {
    const startedAt = params.startedAt ? new Date(params.startedAt) : undefined;
    const endedAt = params.endedAt ? new Date(params.endedAt) : new Date();
    const durationSeconds =
      startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : undefined;

    let log: { businessId: string; conversationId: string | null } | null = null;
    try {
      log = await this.prisma.callLog.update({
        where: { vapiCallId: params.vapiCallId },
        data: {
          status: 'ended',
          endedReason: params.endedReason ?? null,
          startedAt,
          endedAt,
          durationSeconds,
          costUsd: params.costUsd ?? null,
          transcript: params.transcript ?? null,
          summary: params.summary ?? null,
        },
        select: { businessId: true, conversationId: true },
      });
    } catch (error) {
      this.logger.warn(`finalizeFromReport(${params.vapiCallId}) ignorado: ${(error as Error).message}`);
      return;
    }

    if (log.conversationId) {
      await this.prisma.conversation.update({
        where: { id: log.conversationId },
        data: {
          status: 'CLOSED',
          summary: params.summary ?? undefined,
          lastMessagePreview: params.summary?.slice(0, 280) ?? undefined,
        },
      });
      this.realtime.conversationUpdated(log.businessId, {
        conversationId: log.conversationId,
        status: 'CLOSED',
      });
    }
  }
}
```

- [ ] **Step 4: Registrar el provider en el módulo**

En `apps/api/src/calls/calls.module.ts`: agregar `CallLogService` a `providers` (import arriba).

- [ ] **Step 5: Correr los tests**

Run: `pnpm --filter api test -- call-log.service.spec`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/calls/call-log.service.ts apps/api/src/calls/call-log.service.spec.ts apps/api/src/calls/calls.module.ts
git commit -m "feat(calls): CallLogService (registro de llamada + cierre de conversación)"
```

---

## Task 7: VapiBridgeService (OpenAI ↔ Agent Core)

**Files:**
- Create: `apps/api/src/calls/vapi-bridge.service.ts`
- Modify: `apps/api/src/calls/calls.module.ts` (provider)
- Modify: `apps/api/src/calls/calls.types.ts` (tipos OpenAI)
- Test: `apps/api/src/calls/vapi-bridge.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AgentService` (`run(input: AgentRunInput): Promise<AgentRunResult>` con `AgentRunResult.message: string`), `BusinessesService`, `CallConfigService`, `CallLogService`.
- Produces `class VapiBridgeService`:
  - `handleChatCompletion(body: VapiChatCompletionBody, res: Response): Promise<void>` — resuelve businessId + call.id, busca/crea la `Conversation` VOICE, corre `agent.run({ channel: 'VOICE', maxStepsOverride: 4, ... })`, responde SSE OpenAI (o JSON si `stream === false`). Nunca lanza; ante error interno responde un chunk de fallback.
- `interface VapiChatCompletionBody { model?: string; stream?: boolean; messages?: Array<{ role: string; content?: string | null }>; call?: { id?: string }; metadata?: Record<string, unknown>; phoneNumber?: { number?: string }; customer?: { number?: string } }`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/calls/vapi-bridge.service.spec.ts`:

```ts
import { VapiBridgeService } from './vapi-bridge.service';

function mockRes() {
  const chunks: string[] = [];
  return {
    chunks,
    headersSent: false,
    writeHead: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn((s: string) => { chunks.push(s); return true; }),
    end: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('VapiBridgeService', () => {
  const prisma = { conversation: { findFirst: jest.fn(), create: jest.fn() } };
  const agent = { run: jest.fn() };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const callConfig = { getForRuntime: jest.fn() };
  const callLog = { startInboundCall: jest.fn() };
  const service = new VapiBridgeService(
    prisma as never, agent as never, businesses as never,
    callConfig as never, callLog as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv_1', contactPhone: '+549110' });
    agent.run.mockResolvedValue({ conversationId: 'conv_1', message: 'Hola, ¿en qué te ayudo?', status: 'AI' });
  });

  it('corre el agente con channel VOICE y maxStepsOverride, y emite SSE', async () => {
    const res = mockRes();
    await service.handleChatCompletion(
      {
        stream: true,
        call: { id: 'call_1' },
        metadata: { businessId: 'biz-1' },
        messages: [
          { role: 'system', content: 'x' },
          { role: 'user', content: 'hola' },
        ],
      } as never,
      res as never,
    );

    expect(agent.run).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      conversationId: 'conv_1',
      channel: 'VOICE',
      message: 'hola',
      maxStepsOverride: 4,
    }));
    const body = res.chunks.join('');
    expect(body).toContain('"content":"Hola, ¿en qué te ayudo?"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('data: [DONE]');
    expect(res.end).toHaveBeenCalled();
  });

  it('stream=false responde JSON chat.completion', async () => {
    const res = mockRes();
    await service.handleChatCompletion(
      { stream: false, call: { id: 'call_1' }, metadata: { businessId: 'biz-1' },
        messages: [{ role: 'user', content: 'hola' }] } as never,
      res as never,
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      object: 'chat.completion',
      choices: [expect.objectContaining({ message: { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' } })],
    }));
  });

  it('si agent.run explota, emite un chunk de fallback y no lanza', async () => {
    agent.run.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await expect(service.handleChatCompletion(
      { stream: true, call: { id: 'call_1' }, metadata: { businessId: 'biz-1' },
        messages: [{ role: 'user', content: 'hola' }] } as never,
      res as never,
    )).resolves.toBeUndefined();
    const body = res.chunks.join('');
    expect(body).toContain('data: [DONE]');
    expect(body.toLowerCase()).toMatch(/problema|repet/);
  });

  it('crea la conversación VOICE si no existe', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conv_new', contactPhone: null });
    const res = mockRes();
    await service.handleChatCompletion(
      { stream: true, call: { id: 'call_2' }, metadata: { businessId: 'biz-1' },
        customer: { number: '+549112' },
        messages: [{ role: 'user', content: 'hola' }] } as never,
      res as never,
    );
    expect(prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 'biz-1', channel: 'VOICE', externalId: 'call_2' }),
    }));
    expect(callLog.startInboundCall).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm --filter api test -- vapi-bridge.service.spec`
Expected: FAIL ("Cannot find module './vapi-bridge.service'").

- [ ] **Step 3: Agregar tipos OpenAI a `calls.types.ts`**

```ts
export interface VapiChatMessage {
  role: string;
  content?: string | null;
}

export interface VapiChatCompletionBody {
  model?: string;
  stream?: boolean;
  messages?: VapiChatMessage[];
  call?: { id?: string };
  metadata?: Record<string, unknown>;
  phoneNumber?: { number?: string };
  customer?: { number?: string };
}
```

- [ ] **Step 4: Implementar `VapiBridgeService`**

Crear `apps/api/src/calls/vapi-bridge.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentService } from '../ai/agents/agent.service';
import { BusinessesService } from '../businesses/businesses.service';
import { CallConfigService } from './call-config.service';
import { CallLogService } from './call-log.service';
import type { VapiChatCompletionBody } from './calls.types';

const VOICE_MAX_STEPS = 4;
const FALLBACK = 'Perdón, tuve un problema. ¿Podés repetir?';

@Injectable()
export class VapiBridgeService {
  private readonly logger = new Logger(VapiBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
    private readonly businesses: BusinessesService,
    private readonly callConfig: CallConfigService,
    private readonly callLog: CallLogService,
  ) {}

  async handleChatCompletion(body: VapiChatCompletionBody, res: Response): Promise<void> {
    const callId = body.call?.id ?? String(body.metadata?.callId ?? '');
    const streaming = body.stream !== false;
    let text = FALLBACK;

    try {
      const businessId =
        (typeof body.metadata?.businessId === 'string' && body.metadata.businessId) ||
        (await this.businesses.getCurrentId());
      const phone = body.customer?.number ?? body.phoneNumber?.number ?? null;
      const conversation = await this.resolveConversation(businessId, callId, phone);

      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'user' && (m.content ?? '').trim());
      const message = (lastUser?.content ?? '').trim();

      if (message) {
        const result = await this.agent.run({
          businessId,
          conversationId: conversation.id,
          channel: 'VOICE',
          maxStepsOverride: VOICE_MAX_STEPS,
          message,
          metadata: { vapiCallId: callId, contactPhone: conversation.contactPhone ?? phone },
        });
        text = result.message?.trim() || FALLBACK;
      } else {
        text = '';
      }
    } catch (error) {
      this.logger.error(`bridge call=${callId} falló: ${(error as Error).message}`);
      text = FALLBACK;
    }

    if (streaming) this.writeSse(res, callId, text);
    else this.writeJson(res, callId, text);
  }

  private async resolveConversation(businessId: string, callId: string, phone: string | null) {
    const existing = await this.prisma.conversation.findFirst({
      where: { businessId, channel: 'VOICE', externalId: callId },
    });
    if (existing) return existing;

    const created = await this.prisma.conversation.create({
      data: {
        businessId,
        channel: 'VOICE',
        status: 'AI',
        externalId: callId,
        contactPhone: phone,
        metadata: { source: 'vapi-inbound' },
      },
    });
    await this.callLog.startInboundCall({
      businessId,
      vapiCallId: callId,
      conversationId: created.id,
      fromNumber: phone,
    });
    return created;
  }

  private writeSse(res: Response, callId: string, text: string): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const id = `chatcmpl-${callId || Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const base = { id, object: 'chat.completion.chunk', created, model: 'agent-core' };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }

  private writeJson(res: Response, callId: string, text: string): void {
    res.status(200).json({
      id: `chatcmpl-${callId || Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'agent-core',
      choices: [
        { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
      ],
    });
  }
}
```

- [ ] **Step 5: Registrar el provider**

En `apps/api/src/calls/calls.module.ts`: agregar `VapiBridgeService` a `providers`.

- [ ] **Step 6: Correr los tests**

Run: `pnpm --filter api test -- vapi-bridge.service.spec`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/calls/vapi-bridge.service.ts apps/api/src/calls/vapi-bridge.service.spec.ts apps/api/src/calls/calls.types.ts apps/api/src/calls/calls.module.ts
git commit -m "feat(calls): VapiBridgeService (custom-llm ↔ AgentService, SSE)"
```

---

## Task 8: VapiWebhookService (eventos + assistant transitorio)

**Files:**
- Create: `apps/api/src/calls/vapi-webhook.service.ts`
- Modify: `apps/api/src/calls/calls.module.ts` (provider)
- Modify: `apps/api/src/calls/calls.types.ts` (tipos de evento)
- Test: `apps/api/src/calls/vapi-webhook.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `CallConfigService` (`getForRuntime`, `getWebhookSecret`, `resolveWebhookUrl`), `CallLogService`, `BusinessesService`, `LeadsService` (`capture(input): Promise<{ id: string } | null>`).
- Produces `class VapiWebhookService`:
  - `verifySecret(headerValue: string | undefined): Promise<boolean>` — compara con `webhookSecret` del negocio.
  - `handleEvent(message: VapiServerMessage): Promise<Record<string, unknown>>` — router por `message.type`; devuelve el body de respuesta (`{ assistant }` para `assistant-request`, `{}` para el resto).
  - `buildTransientAssistant(config, business): Record<string, unknown>` (privado, testeado vía `handleEvent`).
- `interface VapiServerMessage { type: string; call?: { id?: string; customer?: { number?: string }; phoneNumber?: { number?: string } }; status?: string; endedReason?: string; cost?: number; startedAt?: string; endedAt?: string; artifact?: { transcript?: string }; analysis?: { summary?: string } }`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/calls/vapi-webhook.service.spec.ts`:

```ts
import { VapiWebhookService } from './vapi-webhook.service';

describe('VapiWebhookService', () => {
  const prisma = { conversation: { findFirst: jest.fn(), create: jest.fn() } };
  const callConfig = {
    getForRuntime: jest.fn(),
    getWebhookSecret: jest.fn(async () => 'the-secret'),
    resolveWebhookUrl: jest.fn(() => 'https://api.x.com/api/webhooks/vapi'),
  };
  const callLog = { startInboundCall: jest.fn(), updateStatus: jest.fn(), finalizeFromReport: jest.fn() };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const prismaBusiness = { business: { findUnique: jest.fn() } };
  const leads = { capture: jest.fn() };
  const service = new VapiWebhookService(
    { ...prisma, ...prismaBusiness } as never,
    callConfig as never, callLog as never, businesses as never, leads as never,
  );

  const enabledConfig = {
    businessId: 'biz-1', enabled: true, agentEnabled: true, webhookSecret: 'the-secret',
    voiceProvider: 'vapi', voiceId: 'Elliot', transcriberLanguage: null, firstMessage: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    callConfig.getForRuntime.mockResolvedValue(enabledConfig);
    prismaBusiness.business.findUnique.mockResolvedValue({
      id: 'biz-1', name: 'Pilates X', defaultMessages: { welcome: 'Hola, soy el asistente.' },
    });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conv_1' });
  });

  it('verifySecret compara contra el secret del negocio', async () => {
    expect(await service.verifySecret('the-secret')).toBe(true);
    expect(await service.verifySecret('otro')).toBe(false);
    expect(await service.verifySecret(undefined)).toBe(false);
  });

  it('assistant-request habilitado devuelve assistant transitorio custom-llm', async () => {
    const out = await service.handleEvent({
      type: 'assistant-request',
      call: { id: 'call_1', customer: { number: '+549110' } },
    } as never);

    expect(out.assistant).toMatchObject({
      firstMessage: 'Hola, soy el asistente.',
      model: {
        provider: 'custom-llm',
        url: 'https://api.x.com/api/webhooks/vapi',
        headers: { 'x-vapi-secret': 'the-secret' },
      },
      voice: { provider: 'vapi', voiceId: 'Elliot', version: 2 },
      server: { url: 'https://api.x.com/api/webhooks/vapi', secret: 'the-secret' },
      metadata: { businessId: 'biz-1', source: 'inbound' },
    });
    expect(callLog.startInboundCall).toHaveBeenCalledWith(expect.objectContaining({ vapiCallId: 'call_1' }));
    expect(leads.capture).toHaveBeenCalledWith(expect.objectContaining({ phone: '+549110', source: 'VOICE' }));
  });

  it('assistant-request devuelve error si el asistente está desactivado', async () => {
    callConfig.getForRuntime.mockResolvedValue({ ...enabledConfig, agentEnabled: false });
    const out = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);
    expect(out).toEqual({ error: expect.any(String) });
    expect(out.assistant).toBeUndefined();
  });

  it('transcriber sin language cuando transcriberLanguage es null', async () => {
    const out: any = await service.handleEvent({ type: 'assistant-request', call: { id: 'c' } } as never);
    expect(out.assistant.transcriber.language).toBeUndefined();
  });

  it('status-update delega en callLog.updateStatus', async () => {
    await service.handleEvent({ type: 'status-update', status: 'in-progress', call: { id: 'call_1' } } as never);
    expect(callLog.updateStatus).toHaveBeenCalledWith('call_1', 'in-progress');
  });

  it('end-of-call-report delega en callLog.finalizeFromReport', async () => {
    await service.handleEvent({
      type: 'end-of-call-report',
      call: { id: 'call_1' },
      endedReason: 'customer-ended-call',
      cost: 0.1,
      startedAt: '2026-09-02T10:00:00Z',
      endedAt: '2026-09-02T10:02:00Z',
      artifact: { transcript: 'hola...' },
      analysis: { summary: 'pidió turno' },
    } as never);
    expect(callLog.finalizeFromReport).toHaveBeenCalledWith(expect.objectContaining({
      vapiCallId: 'call_1', costUsd: 0.1, transcript: 'hola...', summary: 'pidió turno',
    }));
  });

  it('evento desconocido responde {}', async () => {
    expect(await service.handleEvent({ type: 'speech-update' } as never)).toEqual({});
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm --filter api test -- vapi-webhook.service.spec`
Expected: FAIL ("Cannot find module './vapi-webhook.service'").

- [ ] **Step 3: Agregar tipos de evento a `calls.types.ts`**

```ts
export interface VapiServerMessage {
  type: string;
  call?: {
    id?: string;
    customer?: { number?: string };
    phoneNumber?: { number?: string };
  };
  status?: string;
  endedReason?: string;
  cost?: number;
  startedAt?: string;
  endedAt?: string;
  artifact?: { transcript?: string };
  analysis?: { summary?: string };
}
```

- [ ] **Step 4: Implementar `VapiWebhookService`**

Crear `apps/api/src/calls/vapi-webhook.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { VapiCallConfig } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { LeadsService } from '../leads/leads.service';
import { CallConfigService } from './call-config.service';
import { CallLogService } from './call-log.service';
import { DEFAULT_CONFIGURED_MESSAGES } from '../common/constants';
import type { VapiServerMessage } from './calls.types';

const DISABLED_MESSAGE = 'El asistente de voz no está disponible en este momento.';

@Injectable()
export class VapiWebhookService {
  private readonly logger = new Logger(VapiWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly callConfig: CallConfigService,
    private readonly callLog: CallLogService,
    private readonly businesses: BusinessesService,
    private readonly leads: LeadsService,
  ) {}

  async verifySecret(headerValue: string | undefined): Promise<boolean> {
    if (!headerValue) return false;
    const secret = await this.callConfig.getWebhookSecret();
    return Boolean(secret) && headerValue === secret;
  }

  async handleEvent(message: VapiServerMessage): Promise<Record<string, unknown>> {
    switch (message.type) {
      case 'assistant-request':
        return this.handleAssistantRequest(message);
      case 'status-update':
        if (message.call?.id && message.status) {
          await this.callLog.updateStatus(message.call.id, message.status);
        }
        return {};
      case 'end-of-call-report':
        if (message.call?.id) {
          await this.callLog.finalizeFromReport({
            vapiCallId: message.call.id,
            endedReason: message.endedReason,
            startedAt: message.startedAt,
            endedAt: message.endedAt,
            costUsd: message.cost,
            transcript: message.artifact?.transcript,
            summary: message.analysis?.summary,
          });
        }
        return {};
      case 'hang':
        this.logger.warn(`Vapi hang en call=${message.call?.id ?? '?'}`);
        return {};
      default:
        return {};
    }
  }

  private async handleAssistantRequest(
    message: VapiServerMessage,
  ): Promise<Record<string, unknown>> {
    const config = await this.callConfig.getForRuntime();
    if (!config || !config.enabled || !config.agentEnabled) {
      return { error: DISABLED_MESSAGE };
    }

    const businessId = config.businessId;
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return { error: DISABLED_MESSAGE };

    const callId = message.call?.id ?? '';
    const phone = message.call?.customer?.number ?? message.call?.phoneNumber?.number ?? null;

    if (callId) {
      const conversation = await this.upsertConversation(businessId, callId, phone);
      await this.callLog.startInboundCall({
        businessId,
        vapiCallId: callId,
        conversationId: conversation.id,
        fromNumber: phone,
      });
      if (phone) {
        try {
          await this.leads.capture({
            businessId,
            conversationId: conversation.id,
            phone,
            source: 'VOICE',
          });
        } catch (error) {
          this.logger.warn(`leads.capture (voz) falló: ${(error as Error).message}`);
        }
      }
    }

    return { assistant: this.buildTransientAssistant(config, business) };
  }

  private async upsertConversation(businessId: string, callId: string, phone: string | null) {
    const existing = await this.prisma.conversation.findFirst({
      where: { businessId, channel: 'VOICE', externalId: callId },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: {
        businessId,
        channel: 'VOICE',
        status: 'AI',
        externalId: callId,
        contactPhone: phone,
        metadata: { source: 'vapi-inbound' },
      },
    });
  }

  private buildTransientAssistant(
    config: VapiCallConfig,
    business: { name: string; defaultMessages: unknown },
  ): Record<string, unknown> {
    const webhookUrl = this.callConfig.resolveWebhookUrl();
    const welcome =
      (typeof business.defaultMessages === 'object' &&
        business.defaultMessages &&
        (business.defaultMessages as Record<string, string>).welcome) ||
      DEFAULT_CONFIGURED_MESSAGES.welcome;

    const transcriber: Record<string, unknown> = { provider: 'deepgram', model: 'flux-general-multi' };
    if (config.transcriberLanguage) transcriber.language = config.transcriberLanguage;

    return {
      name: `${business.name} — Asistente`.slice(0, 40),
      firstMessage: config.firstMessage ?? welcome,
      firstMessageMode: 'assistant-speaks-first',
      model: {
        provider: 'custom-llm',
        model: 'agent-core',
        url: webhookUrl,
        headers: { 'x-vapi-secret': config.webhookSecret },
      },
      voice: { provider: config.voiceProvider, voiceId: config.voiceId, version: 2 },
      transcriber,
      server: { url: webhookUrl, secret: config.webhookSecret },
      metadata: { businessId: config.businessId, source: 'inbound' },
      analysisPlan: { summaryPlan: { enabled: true } },
    };
  }
}
```

- [ ] **Step 5: Registrar el provider**

En `apps/api/src/calls/calls.module.ts`: agregar `VapiWebhookService` a `providers`.

- [ ] **Step 6: Correr los tests**

Run: `pnpm --filter api test -- vapi-webhook.service.spec`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/calls/vapi-webhook.service.ts apps/api/src/calls/vapi-webhook.service.spec.ts apps/api/src/calls/calls.types.ts apps/api/src/calls/calls.module.ts
git commit -m "feat(calls): VapiWebhookService (assistant-request transitorio + eventos)"
```

---

## Task 9: VapiWebhookController + wiring final

**Files:**
- Create: `apps/api/src/calls/vapi-webhook.controller.ts`
- Modify: `apps/api/src/calls/calls.module.ts` (controller)
- Test: `apps/api/src/calls/vapi-webhook.controller.spec.ts`

**Interfaces:**
- Consumes: `VapiWebhookService` (Task 8), `VapiBridgeService` (Task 7).
- Produces rutas —
  - `POST /api/webhooks/vapi` (eventos): valida `x-vapi-secret`; `401` si falla; devuelve el body de `handleEvent(body.message)`.
  - `POST /api/webhooks/vapi/chat/completions` (bridge): valida `x-vapi-secret`; delega en `bridge.handleChatCompletion(body, res)` con `@Res()` passthrough.
  - Ambas con `@SkipThrottle()`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/src/calls/vapi-webhook.controller.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { VapiWebhookController } from './vapi-webhook.controller';

describe('VapiWebhookController', () => {
  const webhook = { verifySecret: jest.fn(), handleEvent: jest.fn() };
  const bridge = { handleChatCompletion: jest.fn() };
  const controller = new VapiWebhookController(webhook as never, bridge as never);

  beforeEach(() => jest.clearAllMocks());

  it('rechaza eventos sin secret válido', async () => {
    webhook.verifySecret.mockResolvedValue(false);
    await expect(
      controller.events({ 'x-vapi-secret': 'bad' } as never, { message: { type: 'status-update' } }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enruta el evento cuando el secret es válido', async () => {
    webhook.verifySecret.mockResolvedValue(true);
    webhook.handleEvent.mockResolvedValue({ ok: true });
    const out = await controller.events(
      { 'x-vapi-secret': 'good' } as never,
      { message: { type: 'status-update', status: 'ended' } },
    );
    expect(webhook.handleEvent).toHaveBeenCalledWith({ type: 'status-update', status: 'ended' });
    expect(out).toEqual({ ok: true });
  });

  it('chat/completions valida el secret y delega en el bridge', async () => {
    webhook.verifySecret.mockResolvedValue(true);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
    await controller.chatCompletions(
      { 'x-vapi-secret': 'good' } as never,
      { call: { id: 'c1' } } as never,
      res as never,
    );
    expect(bridge.handleChatCompletion).toHaveBeenCalledWith({ call: { id: 'c1' } }, res);
  });

  it('chat/completions rechaza secret inválido', async () => {
    webhook.verifySecret.mockResolvedValue(false);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await expect(
      controller.chatCompletions({ 'x-vapi-secret': 'bad' } as never, {} as never, res as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter api test -- vapi-webhook.controller.spec`
Expected: FAIL ("Cannot find module './vapi-webhook.controller'").

- [ ] **Step 3: Implementar el controller**

Crear `apps/api/src/calls/vapi-webhook.controller.ts`:

```ts
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { VapiWebhookService } from './vapi-webhook.service';
import { VapiBridgeService } from './vapi-bridge.service';
import type { VapiChatCompletionBody, VapiServerMessage } from './calls.types';

@Controller('webhooks/vapi')
@SkipThrottle()
export class VapiWebhookController {
  constructor(
    private readonly webhook: VapiWebhookService,
    private readonly bridge: VapiBridgeService,
  ) {}

  @Post()
  @HttpCode(200)
  async events(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: { message?: VapiServerMessage },
  ) {
    if (!(await this.webhook.verifySecret(headers['x-vapi-secret']))) {
      throw new UnauthorizedException('Secret inválido');
    }
    if (!body?.message?.type) return {};
    return this.webhook.handleEvent(body.message);
  }

  @Post('chat/completions')
  async chatCompletions(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: VapiChatCompletionBody,
    @Res() res: Response,
  ) {
    if (!(await this.webhook.verifySecret(headers['x-vapi-secret']))) {
      throw new UnauthorizedException('Secret inválido');
    }
    await this.bridge.handleChatCompletion(body, res);
  }
}
```

- [ ] **Step 4: Registrar el controller en el módulo**

En `apps/api/src/calls/calls.module.ts`: agregar `VapiWebhookController` a `controllers` (junto a `CallsAdminController`). Verificar que `providers` ya tiene: `SecretsService`, `VapiClient`, `CallConfigService`, `CallLogService`, `VapiBridgeService`, `VapiWebhookService`.

- [ ] **Step 5: Correr toda la suite de `calls/` + build**

Run: `pnpm --filter api test -- calls/ && pnpm --filter api build`
Expected: PASS (todos los specs de `calls/`) + build OK.

- [ ] **Step 6: Smoke test manual del assistant-request**

Con `pnpm docker:infra` + `pnpm dev:api` levantados y una `VapiCallConfig` seedeada a mano (`enabled: true`, `webhookSecret: 'test'`, negocio existente):

```bash
curl -s -X POST http://localhost:3001/api/webhooks/vapi \
  -H 'Content-Type: application/json' -H 'x-vapi-secret: test' \
  -d '{"message":{"type":"assistant-request","call":{"id":"call_test","customer":{"number":"+5491100000000"}}}}' | jq .
```
Expected: JSON `{ "assistant": { "model": { "provider": "custom-llm", ... } } }`. Sin el header → `401`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/calls/vapi-webhook.controller.ts apps/api/src/calls/vapi-webhook.controller.spec.ts apps/api/src/calls/calls.module.ts
git commit -m "feat(calls): VapiWebhookController (/api/webhooks/vapi + /chat/completions)"
```

---

## Task 10: Admin — canal VOICE en la UI

**Files:**
- Modify: `apps/admin/src/components/channel-icons.tsx:145-210`
- Modify: `apps/admin/src/components/conversations-inbox.tsx:120-130`
- Modify: `apps/admin/src/components/dashboard-home.tsx:12-35`
- Modify: `apps/admin/src/components/leads-list.tsx:11-55`

**Interfaces:**
- Produces: el canal `'VOICE'` renderiza con label "Llamada" e icono de teléfono en inbox, dashboard y leads.

- [ ] **Step 1: Icono + label en `channel-icons.tsx`**

Localizar la función que resuelve icono por `value` (tiene ramas `if (value === 'WHATSAPP') {...}` y `if (value === 'WEB') {...}`). Agregar una rama `VOICE` que devuelva un icono de teléfono (SVG inline simple, mismo tamaño que los otros) y, donde haya un mapa de labels, `VOICE: 'Llamada'`. Si hay un objeto `channels` con `whatsapp`, `web`, etc., agregar `voice`.

```tsx
  if (value === 'VOICE') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-label={title}>
        <path
          d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.2 1l-2.3 2.2Z"
          fill="currentColor"
        />
      </svg>
    );
  }
```

- [ ] **Step 2: `conversations-inbox.tsx`**

En el bloque `if (ch === 'WHATSAPP') return channels.whatsapp;` agregar antes del `return` por defecto:

```tsx
  if (ch === 'VOICE') return channels.voice;
```

(usar el icono/estructura que devuelva `channel-icons` para VOICE — si `channels` es un objeto armado en ese archivo, agregar la key `voice`).

- [ ] **Step 3: `dashboard-home.tsx`**

En el objeto de labels de canal (tiene `WHATSAPP: 'WhatsApp'`), agregar:

```tsx
  VOICE: 'Llamada',
```

- [ ] **Step 4: `leads-list.tsx`**

- `type LeadChannel = 'MANUAL' | 'WEB' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'VOICE';`
- En el mapa de labels (`WHATSAPP: 'WhatsApp'`): agregar `VOICE: 'Llamada',`
- En el array de opciones de filtro (`{ value: 'WHATSAPP', label: 'WhatsApp' }`): agregar `{ value: 'VOICE', label: 'Llamada' }`.

- [ ] **Step 5: Lint + build**

Run: `pnpm --filter admin lint && pnpm --filter admin build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/components/channel-icons.tsx apps/admin/src/components/conversations-inbox.tsx apps/admin/src/components/dashboard-home.tsx apps/admin/src/components/leads-list.tsx
git commit -m "feat(admin): canal VOICE en inbox, dashboard y leads"
```

---

## Task 11: Admin — form de la integración "Llamadas"

**Files:**
- Create: `apps/admin/src/components/vapi-call-config-form.tsx`
- Modify: `apps/admin/src/components/integrations-hub.tsx`

**Interfaces:**
- Consumes: `api<T>(path, init?)`, React Query. Endpoints de Task 4.
- Produces: card "Llamadas" en `IntegrationsHub` + panel `'calls'` que renderiza `<VapiCallConfigForm />`.

- [ ] **Step 1: Crear `vapi-call-config-form.tsx`**

Basado en `google-calendar-config-form.tsx`. Contenido:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

interface VapiCallPublicConfig {
  businessId: string;
  hasApiKey: boolean;
  phoneNumberId: string | null;
  phoneNumberE164: string | null;
  voiceProvider: string;
  voiceId: string;
  transcriberLanguage: string | null;
  firstMessage: string | null;
  enabled: boolean;
  agentEnabled: boolean;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  webhookUrl: string;
}

interface VapiPhoneNumber {
  id: string;
  number: string | null;
  name: string | null;
  provider: string;
}

const VOICES = ['Elliot', 'Rohan', 'Lily', 'Savannah', 'Hana', 'Cole', 'Paige', 'Spencer'];

export function VapiCallConfigForm() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['vapi-call-config'],
    queryFn: () => api<VapiCallPublicConfig | null>('/admin/calls'),
  });

  const [apiKey, setApiKey] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [voiceId, setVoiceId] = useState('Elliot');
  const [language, setLanguage] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  if (data && !hydrated) {
    setHydrated(true);
    setPhoneNumberId(data.phoneNumberId ?? '');
    setVoiceId(data.voiceId || 'Elliot');
    setLanguage(data.transcriberLanguage ?? '');
    setFirstMessage(data.firstMessage ?? '');
    setEnabled(data.enabled);
    setAgentEnabled(data.agentEnabled);
  }

  const phoneNumbers = useQuery({
    queryKey: ['vapi-phone-numbers'],
    queryFn: () => api<VapiPhoneNumber[]>('/admin/calls/phone-numbers'),
    enabled: Boolean(data?.hasApiKey || apiKey),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      api<VapiCallPublicConfig>('/admin/calls', {
        method: 'PUT',
        body: JSON.stringify({
          ...(apiKey ? { vapiApiKey: apiKey } : {}),
          phoneNumberId: phoneNumberId || null,
          voiceId,
          transcriberLanguage: language || null,
          firstMessage: firstMessage || null,
          enabled,
          agentEnabled,
        }),
      }),
    onSuccess: async () => {
      setApiKey('');
      await qc.invalidateQueries({ queryKey: ['vapi-call-config'] });
      await qc.invalidateQueries({ queryKey: ['vapi-phone-numbers'] });
    },
  });

  const sync = useMutation({
    mutationFn: () => api('/admin/calls/sync', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vapi-call-config'] }),
  });

  if (isLoading) return <p className="text-sm text-muted">Cargando…</p>;

  const statusLabel =
    data?.status === 'connected' ? 'Conectado' : data?.status === 'error' ? 'Error' : 'Desconectado';

  return (
    <section className="panel rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Llamadas (Vapi)</h3>
          <p className="text-sm text-muted mt-1">
            El asistente atiende llamadas telefónicas entrantes. El número tiene que
            existir en tu cuenta de Vapi. El negocio es responsable de los avisos legales
            de grabación o transcripción de llamadas.
          </p>
        </div>
        <span
          className={`mono text-xs px-2 py-1 rounded border ${
            data?.status === 'connected'
              ? 'border-teal/40 text-teal'
              : data?.status === 'error'
                ? 'border-rose/40 text-rose'
                : 'border-line text-muted'
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {data?.lastError ? <p className="text-sm text-rose">{data.lastError}</p> : null}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">API key de Vapi{data?.hasApiKey ? ' · ya hay una guardada' : ''}</span>
          <input
            type="password"
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            placeholder={data?.hasApiKey ? 'Dejar vacío para mantener la actual' : 'vapi_...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Número</span>
          <select
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          >
            <option value="">— Elegí un número —</option>
            {(phoneNumbers.data ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.number ?? n.id} {n.name ? `(${n.name})` : ''}
              </option>
            ))}
          </select>
          {phoneNumbers.error ? (
            <span className="text-xs text-rose">No pude listar números: revisá la API key.</span>
          ) : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Voz</span>
          <select
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Idioma</span>
          <select
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">Automático</option>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </select>
        </label>

        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Primer mensaje (opcional)</span>
          <input
            className="w-full rounded-md bg-ink border border-line px-3 py-2"
            placeholder="Si lo dejás vacío usa el mensaje de bienvenida del negocio"
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Habilitado
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={agentEnabled}
            onChange={(e) => setAgentEnabled(e.target.checked)}
          />
          Asistente activo
        </label>

        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-amber px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-60 min-h-10"
            disabled={save.isPending}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-4 py-2.5 text-sm disabled:opacity-60 min-h-10"
            disabled={sync.isPending || !data?.phoneNumberId}
            onClick={() => sync.mutate()}
          >
            Resincronizar número
          </button>
          {save.error ? (
            <span className="text-sm text-rose">{(save.error as Error).message}</span>
          ) : null}
          {save.isSuccess ? <span className="text-sm text-teal">Guardado</span> : null}
        </div>
      </form>

      <div className="text-xs text-muted space-y-1 break-all">
        <p>
          URL de webhook (se apunta sola al guardar el número):{' '}
          <span className="text-text">{data?.webhookUrl}</span>
        </p>
        {data?.phoneNumberE164 ? <p>Número conectado: {data.phoneNumberE164}</p> : null}
        {data?.lastSyncedAt ? (
          <p>Última sincronización: {new Date(data.lastSyncedAt).toLocaleString()}</p>
        ) : null}
      </div>
    </section>
  );
}
```

Nota: si algún nombre de voz de `VOICES` no está activo en Vapi al probar (Task 12), ajustar la lista.

- [ ] **Step 2: Card + panel en `integrations-hub.tsx`**

- Agregar `'calls'` al type `Panel`.
- `import { VapiCallConfigForm } from '@/components/vapi-call-config-form';`
- Agregar query:
  ```tsx
  const calls = useQuery({
    queryKey: ['vapi-call-config'],
    queryFn: () => api<{ status: string; enabled: boolean; agentEnabled: boolean } | null>('/admin/calls'),
  });
  const callsConnected = calls.data?.status === 'connected';
  ```
- En el `useMemo` de `title`: `if (panel === 'calls') return 'Llamadas';`
- En el render de panel != 'list': `{panel === 'calls' ? <VapiCallConfigForm /> : null}`
- En la grilla de cards, agregar una card "Llamadas" copiando la estructura de la card de WhatsApp (`onClick={() => setPanel('calls')}`, icono de teléfono, pills `callsConnected ? 'Conectado' : 'Desconectado'` y, si conectado, `calls.data?.agentEnabled !== false ? 'Asistente activo' : 'Asistente inactivo'`). Texto: "Conectá un número de Vapi para que el asistente atienda llamadas entrantes."

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter admin lint && pnpm --filter admin build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/vapi-call-config-form.tsx apps/admin/src/components/integrations-hub.tsx
git commit -m "feat(admin): integración Llamadas (Vapi) con activar/desactivar"
```

---

## Task 12: `.env.example`, README y checklist de verificación manual

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/superpowers/plans/2026-09-02-vapi-voice-calls-QA.md`

**Interfaces:**
- Produces: documentación de la env var y el flujo de conexión; checklist de QA end-to-end.

- [ ] **Step 1: `.env.example`**

Después del bloque de ElevenLabs (línea ~128), agregar:

```
# ─── Vapi — asistente de voz (llamadas entrantes) ───────────────────────────
# La API key real se carga cifrada desde el admin (Integraciones → Llamadas).
# Este env es un fallback global opcional (deployment single-business).
# API key: https://dashboard.vapi.ai/ → Org Settings → API Keys (private key).
VAPI_API_KEY=
```

- [ ] **Step 2: README**

En la sección "Flujos útiles", agregar una subsección después de "Instagram y TikTok (Zernio)":

```markdown
### Llamadas entrantes (Vapi)

El asistente atiende llamadas telefónicas reusando el Agent Core (mismo prompt,
tools, RAG y memoria que WhatsApp/web).

1. Creá una cuenta en [Vapi](https://vapi.ai) y un número (Phone Numbers).
2. Admin → **Integraciones → Llamadas**: pegá la API key privada de Vapi, elegí el
   número, la voz y el idioma. Guardá.
3. Al guardar, el API apunta el `server.url` de ese número a
   `${API_URL}/api/webhooks/vapi` y limpia el assistant asignado: cada llamada
   dispara un `assistant-request` que respondemos con un assistant transitorio
   `custom-llm` apuntando de vuelta a la API.
4. Toggle **Habilitado** / **Asistente activo** para prender o pausar sin tocar Vapi.

Flujo: `Llamada → Vapi (voz) → /api/webhooks/vapi/chat/completions → Agent Core → Vapi → Llamada`.
Las llamadas aparecen en **Conversaciones** como canal *Llamada* con su transcripción;
el resumen, duración y costo quedan en el registro de llamada (`end-of-call-report`).
```

En la tabla de variables de entorno agregar la fila:

```markdown
| `VAPI_API_KEY` | Fallback global de la API key de Vapi (normalmente se carga desde el admin) |
```

- [ ] **Step 3: Crear el checklist de QA**

Crear `docs/superpowers/plans/2026-09-02-vapi-voice-calls-QA.md`:

```markdown
# QA manual — Asistente de voz (Vapi)

Requiere: cuenta Vapi con crédito, un número comprado, API pública accesible
(ngrok/deploy) porque Vapi tiene que llegar a `${API_URL}/api/webhooks/vapi`.

## Verificar contra la doc de Vapi al probar (spec §10)

- [ ] `model.url`: confirmar si Vapi le agrega `/chat/completions`. Si NO, cambiar
      `buildTransientAssistant` para mandar la URL completa y ajustar la ruta del bridge.
- [ ] Header del secret: confirmar que llega como `x-vapi-secret` (case-insensitive).
      Si Vapi usa otro esquema para `model.headers`, ajustar `verifySecret` / el header.
- [ ] `PATCH /phone-number/{id}`: confirmar que acepta `server.secret` inline y que no
      hace falta re-mandar el discriminador `provider`. Si lo exige, mergear el objeto
      remoto en `applyServerUrl`.
- [ ] Transcriber `flux-general-multi`: confirmar que soporta `es`. Si no, usar
      `nova-3` con `language: 'es'`.
- [ ] Voces del `<select>`: confirmar cuáles están activas (v2).

## Flujo end-to-end

- [ ] Admin → Integraciones → Llamadas: pegar API key → el `<select>` lista los números.
- [ ] Elegir número + Guardar → status "Conectado", `lastSyncedAt` seteado.
- [ ] En el dashboard de Vapi, el número quedó sin assistant y con el server URL nuestro.
- [ ] Llamar al número. El asistente saluda con el primer mensaje.
- [ ] Preguntar por horarios/servicios → responde corto, hablado, sin listas.
- [ ] Pedir un turno → ejecuta tools (checkAvailability/createAppointment); tolera la
      demora ("dame un momento").
- [ ] Cortar. En Conversaciones aparece la conversación canal *Llamada* con la
      transcripción turno a turno.
- [ ] `GET /admin/calls/logs` (o la tabla): la llamada con `durationSeconds`, `costUsd`,
      `summary`, `endedReason`.
- [ ] Toggle **Asistente activo** off → llamar → Vapi corta con el mensaje de no disponible.
- [ ] Toggle **Habilitado** off → idem.
- [ ] Observabilidad: hay `AgentExecution` por turno (Playground / analytics).
```

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md docs/superpowers/plans/2026-09-02-vapi-voice-calls-QA.md
git commit -m "docs(calls): env VAPI_API_KEY, README y checklist de QA"
```

---

## Self-Review

**1. Spec coverage:**

| Spec § | Requisito | Task |
|---|---|---|
| 2 | Módulo `calls/` con los 10 archivos | 2–9 |
| 3 | `VapiCallConfig` + `CallLog` + relaciones + migración | 1 |
| 3 | Canal `VOICE` en constants + admin | 1 (API), 10 (admin) |
| 4 | `GET/PUT /admin/calls`, `/phone-numbers`, `/sync`, `/logs` | 4 |
| 4 | `upsert` genera secret, apunta `server.url`, limpia `assistantId`, no rompe si Vapi falla | 3 |
| 4 | Card + form en el admin | 11 |
| 5 | `assistant-request` → transient assistant / `{error}` si disabled | 8 |
| 5 | Bridge OpenAI ↔ `agent.run(channel:'VOICE')` + SSE + no-500 | 7 |
| 5 | `status-update`, `end-of-call-report`, `hang` | 6 (lógica), 8 (router) |
| 5 | Una `Conversation` por llamada (`externalId == vapiCallId`) | 7, 8 |
| 5 | `leads.capture` con `source: 'VOICE'` | 8 |
| 6 | Bloque de prompt telefónico + `channel` en context | 5 |
| 6 | `maxStepsOverride` para voz | 5 (tipo/uso), 7 (bridge lo pasa) |
| 7 | `VAPI_API_KEY` env fallback | 3, 12 |
| 7 | `webhookSecret` verificado en ambos endpoints | 9 |
| 7 | `@SkipThrottle()` | 9 |
| 7 | API key cifrada | 3 |
| 8 | YAGNI respetado (sin salientes/grabación/SDK/etc.) | — (no se implementa) |
| 9 | Tests por servicio | cada task |
| 10 | Puntos a verificar contra doc de Vapi | 12 (checklist) |

Sin huecos.

**2. Placeholder scan:** El único "TODO" mencionado (Task 5 Step 7) está resuelto con una instrucción concreta de saltarlo y cubrir el caso en Task 7. Sin "add error handling" genéricos: cada handler de error tiene código. Sin "similar to Task N": el código se repite donde hace falta.

**3. Type consistency:**
- `CallConfigService`: `getForRuntime`, `getApiKey`, `getWebhookSecret`, `resolveWebhookUrl`, `getPublic`, `upsert`, `syncPhoneNumber`, `setStatus`, `listPhoneNumbers` — usados consistentes en Tasks 4, 7, 8.
- `CallLogService`: `startInboundCall`, `updateStatus`, `finalizeFromReport` — firmas idénticas en Tasks 6, 7, 8.
- `VapiClient`: `listPhoneNumbers(apiKey)`, `getPhoneNumber(apiKey, id)`, `updatePhoneNumber(apiKey, id, patch)` — consistentes Tasks 2, 3.
- `VapiWebhookService.handleEvent(message)` / `verifySecret(header)` — consistentes Tasks 8, 9.
- `VapiBridgeService.handleChatCompletion(body, res)` — consistente Tasks 7, 9.
- `AgentRunInput.maxStepsOverride` / `AgentPromptContext.channel` — definidos Task 5, usados Task 7.
- `x-vapi-secret` (header, lowercase) — consistente Tasks 8, 9.
- `channel: 'VOICE'`, `Lead.source: 'VOICE'`, `externalId == vapiCallId` — consistentes Tasks 7, 8, 10.
