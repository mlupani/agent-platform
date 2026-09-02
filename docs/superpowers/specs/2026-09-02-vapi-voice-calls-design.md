# Asistente de voz (llamadas entrantes) con Vapi — Diseño

- **Fecha:** 2026-09-02
- **Rama:** `pilates`
- **Estado:** aprobado para escribir plan de implementación
- **Alcance:** llamadas telefónicas **entrantes** atendidas por el asistente, vía Vapi, reusando el Agent Core existente. Nueva integración en el admin para activar/desactivar.

## 1. Contexto y decisiones

La plataforma ya tiene un **Agent Core** (`AgentService.run`) agnóstico al canal:
`mensaje → memoria → RAG → LLM → tools → respuesta`, con guardrails, cost-control,
observabilidad (`AgentExecution` / `ToolExecution`), captura de leads y bandeja de
conversaciones. WhatsApp, Web e Instagram son canales sobre ese core.

Vapi es la plataforma de voz: hace STT (transcriber), TTS (voice) y la telefonía.
La lógica del asistente la sigue corriendo nuestro Agent Core.

Decisiones tomadas en el brainstorming:

| Tema | Decisión |
|---|---|
| Arquitectura | **Custom LLM → Agent Core.** El assistant de Vapi usa `model.provider: "custom-llm"` apuntando a un endpoint nuestro OpenAI-compatible que ejecuta `AgentService.run()`. |
| Alcance | **Solo entrantes.** Salientes/batch/programadas quedan fuera. |
| Cuenta / número | El operador **pega su Vapi API key** en el admin y **elige un `phoneNumberId`** de su cuenta (la UI lista los números vía API de Vapi). Nosotros apuntamos el `server.url` de ese número a nuestro webhook. |
| Config del agente | **Reusa el `AgentConfig` default** (mismo prompt/tools/modelo que WhatsApp y web). |
| Grabación | **Solo transcripción + resumen.** No se guarda audio (`recordingUrl`). |

### Por qué custom-LLM y no assistant nativo de Vapi

Un assistant nativo obligaría a: replicar el system prompt del `PromptBuilder` en Vapi,
duplicar los schemas de las 17 tools como funciones, y saltear RAG, memoria, guardrails
y cost-control. El costo de mantener esa sincronía con `AgentConfig` es permanente.
Con custom-LLM, **voz es un canal más**: cero duplicación, la conversación aparece en
la bandeja con su transcripción, y Playground/observabilidad funcionan sin trabajo extra.

Contrapartida aceptada: **latencia**. Un turno simple es 1 llamada al LLM (~1–2 s); un
turno con tools (reservar, disponibilidad) puede ser 3–5 s. Se mitiga con el bloque de
prompt telefónico ("avisá 'dame un momento'") y los mensajes de espera de Vapi.

## 2. Módulo nuevo: `apps/api/src/calls/`

Nombre `calls` (el módulo `voice/` ya existe y es el TTS de ElevenLabs para videos —
sin relación). Estructura espejo del patrón `whatsapp/`:

| Archivo | Rol |
|---|---|
| `calls.module.ts` | Registra todo. Imports: `AiModule` (AgentService), `BusinessesModule`, `RealtimeModule`, `LeadsModule`. Provee `SecretsService`. |
| `vapi.client.ts` | Wrapper `fetch` sobre `https://api.vapi.ai`. Métodos: `listPhoneNumbers()`, `getPhoneNumber(id)`, `updatePhoneNumber(id, patch)`. Usa `withTimeout` y `withExponentialBackoff` (`common/utils`). API key por parámetro. |
| `call-config.service.ts` | Config 1:1 por negocio. Espejo de `WhatsAppConfigService`: `getPublic()`, `getForRuntime(businessId?)`, `upsert(input)`, `setStatus(...)`, `getApiKey(businessId?)` (desencripta `vapiApiKeyEnc` o cae a `env.VAPI_API_KEY`), `resolveWebhookUrl()`. |
| `calls-admin.controller.ts` | `@Controller('admin/calls')` + `@UseGuards(ApiKeyGuard)`. |
| `vapi-webhook.controller.ts` | `@Controller('webhooks/vapi')` + `@SkipThrottle()`. |
| `vapi-webhook.service.ts` | Router de eventos de servidor de Vapi (`assistant-request`, `status-update`, `end-of-call-report`, `hang`). Verifica el secret. |
| `vapi-bridge.service.ts` | Traduce `POST /chat/completions` (OpenAI) ↔ `AgentService.run()`. Emite SSE. |
| `call-log.service.ts` | Crea/actualiza `CallLog` y la `Conversation` asociada; emite eventos realtime. |
| `calls.types.ts` | `VapiCallPublicConfig`, tipos de payloads de Vapi, tipos OpenAI mínimos. |
| `*.spec.ts` | Tests (sección 9). |

Registrar `CallsModule` en `apps/api/src/app.module.ts`.

## 3. Modelo de datos (Prisma + 1 migración)

Archivo: `apps/api/prisma/schema.prisma`. Migración:
`apps/api/prisma/migrations/<timestamp>_vapi_voice_calls/`.

```prisma
/// Config del asistente de voz (Vapi) — una fila por negocio.
model VapiCallConfig {
  id                  String   @id @default(uuid())
  businessId          String   @unique
  business            Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  /// API key de Vapi cifrada (AES-256-GCM). Si null, se usa env VAPI_API_KEY.
  vapiApiKeyEnc       String?
  /// phoneNumberId de la cuenta Vapi del negocio.
  phoneNumberId       String?
  /// Número en E.164 para mostrar en el admin.
  phoneNumberE164     String?
  voiceProvider       String   @default("vapi")
  voiceId             String   @default("Elliot")
  /// Código de idioma del transcriber. null = detección automática.
  transcriberLanguage String?
  /// Primer mensaje del asistente. null = defaultMessages.welcome del negocio.
  firstMessage        String?
  /// Secret compartido que Vapi manda en X-Vapi-Secret. Se genera al conectar.
  webhookSecret       String?
  enabled             Boolean  @default(false)
  /// Si false: el número queda conectado pero el asistente no atiende.
  agentEnabled        Boolean  @default(true)
  /// disconnected | connected | error
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
  /// id de la llamada en Vapi.
  vapiCallId      String        @unique
  /// inbound (único por ahora)
  direction       String        @default("inbound")
  fromNumber      String?
  toNumber        String?
  /// ringing | in-progress | ended | failed
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

En `model Business` agregar las relaciones inversas:
`vapiCallConfig VapiCallConfig?` y `callLogs CallLog[]`.
En `model Conversation` agregar `callLogs CallLog[]`.

### Canal `VOICE`

`apps/api/src/common/constants.ts`: agregar `'VOICE'` a `channelTypes`.
No entra en `messagingChannels` (no hay provider outbound de texto) ni en
`ADMIN_ONLY_CONVERSATION_CHANNELS` (sí se ve en la bandeja).

Admin: agregar label + icono `VOICE` ("Llamada") en `channel-icons.tsx`,
`conversations-inbox.tsx`, `dashboard-home.tsx`, `leads-list.tsx` (mismo lugar donde
hoy se maneja `WHATSAPP` / `WEB`).

## 4. Activación / desactivación (nueva card "Llamadas")

### Backend — `calls-admin.controller.ts`

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/admin/calls` | Config pública (`VapiCallPublicConfig`): sin secretos, con `hasApiKey`, `webhookUrl`, `status`, `lastError`, `phoneNumberE164`, voz, idioma, `firstMessage`, `enabled`, `agentEnabled`. Devuelve `null` si nunca se configuró. |
| `PUT` | `/admin/calls` | Upsert. Body Zod: `vapiApiKey?`, `phoneNumberId?`, `voiceId?`, `voiceProvider?`, `transcriberLanguage?` (`''` → null/auto), `firstMessage?`, `enabled?`, `agentEnabled?`. |
| `GET` | `/admin/calls/phone-numbers` | Lista `{ id, number, name, provider }[]` desde `vapi.client.listPhoneNumbers()`. Error 400 legible si no hay API key. |
| `POST` | `/admin/calls/sync` | Re-aplica el `server.url` + `secret` al `phoneNumberId` actual (para cuando cambia `API_URL` o se rota el secret). |
| `GET` | `/admin/calls/logs?limit=20` | Últimas `CallLog` del negocio. |

### `call-config.service.upsert(input)`

1. Resolver `businessId` (`businesses.getCurrentId()`).
2. `vapiApiKeyEnc`: si viene `vapiApiKey`, `secrets.encrypt(...)`; si no, mantener.
3. Si `webhookSecret` es null, generar uno (`randomBytes(24).toString('hex')`).
4. `upsert` de `VapiCallConfig`.
5. **Si hay `phoneNumberId` + API key resoluble**, apuntar el número:
   - `vapi.client.getPhoneNumber(id)` → tomar el objeto, **preservar el discriminador
     `provider`** y campos ajenos.
   - `vapi.client.updatePhoneNumber(id, { assistantId: null, squadId: null, server: { url: resolveWebhookUrl(), secret: webhookSecret } })`.
   - `resolveWebhookUrl()` = `${API_URL || NEXT_PUBLIC_API_URL sin /api}/api/webhooks/vapi`
     (mismo helper que `WhatsAppConfigService.resolveWebhookUrl`).
   - Éxito → `status: 'connected'`, `lastSyncedAt: now`, `lastError: null`,
     `phoneNumberE164` del número.
   - Falla → `status: 'error'`, `lastError: mensaje`. No romper el guardado de la config.
6. `enabled` / `agentEnabled` **no llaman a Vapi**: se evalúan en `assistant-request`.
   Activar/desactivar es instantáneo y reversible sin red.

### Frontend — `apps/admin/src/components/vapi-call-config-form.tsx`

Patrón de `google-calendar-config-form.tsx` (React Query + `api()` helper + mutación `PUT`).
Campos:

- **API key de Vapi** (`type=password`, placeholder "ya hay una guardada" si `hasApiKey`).
- **Número**: `<select>` poblado con `GET /admin/calls/phone-numbers` (query aparte,
  habilitada sólo si `hasApiKey`). Muestra `number` + `name`.
- **Voz**: `<select>` con un set curado de voces Vapi v2 (`Elliot`, etc.) — lista
  estática en el front, la fuente de verdad es la doc de Vapi.
- **Idioma**: `auto` | `es` | `en` (`auto` → `transcriberLanguage = ''`).
- **Primer mensaje**: `<input>` opcional (placeholder = welcome message del negocio).
- Toggles **Habilitado** y **Asistente activo**.
- Pill de estado (`connected` / `error` / `disconnected`) + `lastError`.
- Bloque read-only con la **URL de webhook** y botón **"Resincronizar número"**
  (`POST /admin/calls/sync`).
- Nota: "El número tiene que existir en tu cuenta de Vapi. El negocio es responsable
  de los avisos legales de grabación/transcripción de llamadas."

En `integrations-hub.tsx`: nueva `Panel` `'calls'` + card "Llamadas" con icono de
teléfono, siguiendo el patrón de las cards existentes. `useQuery(['vapi-call-config'])`
→ `GET /admin/calls`. Pills "Conectado / Desconectado" y "Asistente activo / inactivo"
(igual que WhatsApp).

## 5. Flujo de llamada entrante

```
Cliente llama al número
      │
      ▼
Vapi (número con server.url, sin assistantId)
      │  POST ${API_URL}/api/webhooks/vapi        (X-Vapi-Secret)
      │  { message: { type: "assistant-request", call: {...} } }
      ▼
vapi-webhook.service.handleAssistantRequest()
      │  - verifica X-Vapi-Secret contra webhookSecret
      │  - carga VapiCallConfig; si !enabled || !agentEnabled → { error: "..." }
      │  - crea CallLog(status: ringing) + Conversation(channel: VOICE)
      │  - leads.capture({ ..., phone: customer.number, source: 'VOICE' })
      ▼
  responde { assistant: <transient> }
      │
      ▼
Vapi arranca la llamada, dice firstMessage
      │
      │  cada turno del usuario:
      │  POST ${API_URL}/api/webhooks/vapi/chat/completions   (X-Vapi-Secret)
      │  { model, messages:[...], stream:true, call:{id}, ...metadata }
      ▼
vapi-bridge.service.handleChatCompletion()
      │  - resuelve businessId (metadata) + call.id
      │  - Conversation por externalId == call.id
      │  - último message role:"user" → texto
      │  - agent.run({ channel:'VOICE', conversationId, message, metadata:{ vapiCallId, contactPhone } })
      │      · dentro: memoria, RAG, tools, guardrails, cost-control, AgentExecution
      │      · persiste Message(CLIENT) + Message(AI)  → transcripción en la bandeja
      ▼
  responde SSE: 1 chunk chat.completion.chunk con choices[0].delta.content
                + choices[0].finish_reason:"stop" + "data: [DONE]"
      │
      │  status-update  → CallLog.status + realtime
      │  end-of-call-report → CallLog (endedReason, durationSeconds, costUsd,
      │                       transcript, summary) + Conversation.summary +
      │                       Conversation cierra (status CLOSED) + realtime
      ▼
```

### `assistant-request` → assistant transitorio

No se crea un assistant persistente en Vapi. Se responde uno **transitorio**
construido en vivo desde `AgentConfig` default + `Business`:

```jsonc
{
  "assistant": {
    "name": "<business.name> — Asistente",            // ≤ 40 chars, truncar
    "firstMessage": "<config.firstMessage ?? defaultMessages.welcome>",
    "firstMessageMode": "assistant-speaks-first",
    "model": {
      "provider": "custom-llm",
      "model": "agent-core",
      "url": "${API_URL}/api/webhooks/vapi"           // Vapi le agrega /chat/completions
    },
    "voice": { "provider": "<config.voiceProvider>", "voiceId": "<config.voiceId>", "version": 2 },
    "transcriber": {
      "provider": "deepgram",
      "model": "flux-general-multi",
      // language sólo si config.transcriberLanguage != null
      "language": "<config.transcriberLanguage>"
    },
    "server": { "url": "${API_URL}/api/webhooks/vapi", "secret": "<webhookSecret>" },
    "metadata": { "businessId": "<id>", "source": "inbound" },
    "analysisPlan": { "summaryPlan": { "enabled": true } }
  }
}
```

- `endCall` tool nativo: attach en `model.tools` con la forma nativa vigente, y en el
  prompt telefónico (sección 6) definir cuándo cerrar ("cuando el cliente se despide o
  ya resolvió"). Verificar la forma exacta contra la doc de default-tools al implementar.
- Si `!enabled` o `!agentEnabled`: responder `{ "error": "El asistente de voz está desactivado." }`.

### Bridge OpenAI ↔ Agent Core (`vapi-bridge.service.ts`)

Ruta: `POST /api/webhooks/vapi/chat/completions` (declarada en `vapi-webhook.controller`).

Entrada (relevante): `{ call: { id }, metadata: { businessId }, messages: [...], stream }`.
Puede que `businessId`/`call` lleguen anidados en distintas formas → lookup defensivo
(`body.call?.id ?? body.message?.call?.id`, etc.).

1. Resolver `businessId`: de `metadata.businessId`; fallback `businesses.getCurrentId()`
   (single-business).
2. Resolver `Conversation`: `findFirst({ businessId, channel:'VOICE', externalId: callId })`.
   Si no existe (llegó el chat antes que se persistiera el assistant-request), crearla.
   **Una `Conversation` por llamada** (clave `externalId == vapiCallId`); no se
   deduplica por teléfono como en WhatsApp. El historial entre llamadas lo aporta el
   Memory Service (hechos long-term por `userId`), y en la bandeja quedan agrupadas por
   `contactPhone`.
3. Extraer el último `message` con `role === 'user'`. Si no hay texto → responder un
   chunk vacío con `finish_reason: "stop"` (Vapi espera algo).
4. `agent.run({ businessId, conversationId, channel: 'VOICE', message, metadata: { vapiCallId: callId, contactPhone } })`.
5. Responder **SSE OpenAI**:
   ```
   Content-Type: text/event-stream
   data: {"id":"chatcmpl-<callId>","object":"chat.completion.chunk","created":<ts>,
          "model":"agent-core","choices":[{"index":0,"delta":{"content":"<result.message>"},
          "finish_reason":null}]}

   data: {"id":"chatcmpl-<callId>","object":"chat.completion.chunk","created":<ts>,
          "model":"agent-core","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

   data: [DONE]
   ```
   - Fase 1: **un solo chunk** con todo el texto. Suficiente para que Vapi lo mande al TTS.
   - Si `body.stream === false`: responder JSON `chat.completion` no-streaming
     (`choices[0].message.content`).
   - Opcional futuro: partir por oración para bajar el time-to-first-audio.
6. Errores dentro de `agent.run` → responder un chunk con un texto de fallback
   ("Perdón, tuve un problema. ¿Podés repetir?") y `finish_reason: "stop"` (nunca 500,
   Vapi cortaría la llamada).

### Eventos de servidor (`vapi-webhook.service.ts`)

Router sobre `message.type`. Todos verifican `X-Vapi-Secret`. Todos responden `{}` salvo
`assistant-request`.

| Evento | Acción |
|---|---|
| `assistant-request` | Ver arriba. |
| `status-update` | `call-log.service.updateStatus(vapiCallId, status)`. Map `in-progress`→`in-progress`, `ended`→`ended`. `realtime.conversationUpdated`. |
| `end-of-call-report` | `CallLog`: `endedReason`, `endedAt`, `startedAt`, `durationSeconds` (de `startedAt`/`endedAt`), `costUsd` (`message.cost`), `transcript` (`artifact.transcript`), `summary` (`analysis.summary`). `Conversation`: `summary`, `status: 'CLOSED'`, `lastMessagePreview`. `realtime.conversationUpdated`. |
| `hang` | log `warn` + `CallLog.metadata.hang = true`. |
| otros (`transcript`, `speech-update`) | ignorar, responder `{}`. No los persistimos (las `Message` ya vienen del bridge). |

## 6. Prompt telefónico (cambio mínimo y aislado)

`apps/api/src/ai/prompts/prompt-builder.service.ts`:
`buildFromContext(ctx)` recibe un `channel?: string` opcional. Cuando
`ctx.channel === 'VOICE'`, agrega al final del system prompt:

> **Estás en una llamada telefónica.** Respuestas breves y habladas: 1–3 frases, una
> sola pregunta por vez. Decí números, horarios y montos en palabras ("las tres y
> media", "quince mil pesos"). Nada de listas, viñetas, markdown ni emojis. Si tenés
> que buscar algo (disponibilidad, datos), avisá "dame un momento" antes. Para cortar,
> despedite y usá la herramienta de fin de llamada.

`apps/api/src/ai/agents/agent.service.ts`: pasar `channel: input.channel` dentro del
objeto que se pasa a `promptBuilder.buildFromContext({ ... })` (hoy no se pasa).
Sin `channel` o con otro valor, el prompt queda idéntico a hoy.

## 7. Configuración, entorno y seguridad

- `.env.example`: bloque nuevo
  ```
  # Vapi — asistente de voz (llamadas entrantes). API key real se carga cifrada en el admin.
  # Este env es fallback global opcional (single-business).
  VAPI_API_KEY=
  ```
  `API_URL` ya existe y es lo que usa `resolveWebhookUrl()`.
- **Secret de webhook**: `webhookSecret` random por negocio, guardado tal cual en
  `VapiCallConfig` (es nuestro secreto compartido, se compara, no se muestra al usuario).
  Vapi lo manda en `X-Vapi-Secret`. Verificar en **ambos** endpoints (`/webhooks/vapi` y
  `/webhooks/vapi/chat/completions`). Rechazo → `401`.
- **API key de Vapi**: cifrada con `SecretsService` (AES-256-GCM, `ENCRYPTION_KEY`).
  Nunca al front, nunca en logs, nunca al LLM.
- `@SkipThrottle()` en `vapi-webhook.controller` (igual que WAHA).
- El bridge nunca devuelve 5xx: Vapi corta la llamada ante un error HTTP.
- No se envía `ADMIN_API_KEY` ni el email del usuario a Vapi.

## 8. Qué NO entra (YAGNI)

- Llamadas salientes, batch, programadas.
- Grabación / almacenamiento de audio (`recordingUrl`).
- Compra / import de número desde la UI (el número se crea en el panel de Vapi).
- `AgentConfig` dedicado a voz.
- Squads / routing multi-assistant / transferencia a humano por SIP.
- Web calls (SDK de browser).
- Assistant persistente en Vapi (se usa transitorio vía `assistant-request`).
- Streaming token-a-token real desde el LLM (1 chunk SSE alcanza para fase 1).
- SDK `@vapi-ai/server-sdk` (la superficie que usamos —listar/patch número— es chica;
  `fetch` alcanza y mantiene las deps livianas, igual que el cliente WAHA).

## 9. Tests (jest, patrón `*.spec.ts` existente)

- `vapi-bridge.service.spec.ts`
  - request OpenAI válido → `agent.run` llamado con `channel:'VOICE'`, `conversationId`
    correcto y el último mensaje `user`.
  - respuesta SSE: contiene el chunk con `delta.content`, el chunk `finish_reason:"stop"`
    y `data: [DONE]`.
  - `stream:false` → JSON `chat.completion` no-streaming.
  - `agent.run` lanza → responde chunk de fallback, no 500.
- `vapi-webhook.service.spec.ts`
  - `assistant-request` con config `enabled` → devuelve `{ assistant }` con
    `model.provider:'custom-llm'` y `url` correcta.
  - `assistant-request` con `enabled:false` o `agentEnabled:false` → `{ error }`.
  - `X-Vapi-Secret` inválido → `401`.
  - `end-of-call-report` → `CallLog` actualizado (`durationSeconds`, `costUsd`,
    `summary`, `transcript`) y `Conversation` cerrada.
- `call-config.service.spec.ts`
  - `upsert` con `vapiApiKey` → se cifra; sin key → se mantiene.
  - `upsert` con `phoneNumberId` → llama `vapi.client.updatePhoneNumber` con
    `assistantId:null` + `server.url/secret`; falla de Vapi → `status:'error'` pero la
    config se guarda igual.
  - `getApiKey` cae a `env.VAPI_API_KEY` si no hay `vapiApiKeyEnc`.
- `vapi.client.spec.ts`
  - `updatePhoneNumber` hace `GET` previo y preserva el discriminador `provider` en el
    `PATCH` (mock de `fetch`).

## 10. A verificar contra la doc de Vapi al implementar

1. **`model.url`**: base vs full. La doc muestra ambas (`.../chat/completions` en
   tool-calling-integration; "BASE URL" en fine-tuned-models). Asumimos que Vapi agrega
   `/chat/completions`; si usa la url tal cual, poner el path completo.
2. **Header del secret**: `X-Vapi-Secret` (confirmado como legacy soportado para
   `server.secret`). Alternativa moderna: `credentialId` (fuera de alcance fase 1).
3. **`PATCH /phone-number/{id}`**: shape del body y discriminador `provider`
   (`byo-phone-number`, `twilio`, `vapi`, `telnyx`…). Hacer `GET` y merge.
4. **Transcriber**: nombre vigente del modelo multilingüe (`flux-general-multi` en la
   doc actual). Verificar que soporta `es`.
5. **Voces**: `Elliot` v2 es baseline; confirmar el set curado para el `<select>`.
6. **`endCall` tool**: forma nativa vigente (`type:"endCall"` en `model.tools`).
7. **`end-of-call-report`**: nombres exactos de `artifact.transcript`, `analysis.summary`,
   `message.cost`, `startedAt`/`endedAt`.
