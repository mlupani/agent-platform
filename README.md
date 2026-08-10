# Agent Platform (Novalup)

Template **single-business** deployable por cliente: **1 clone + 1 DB + 1 deploy**.
La personalización del negocio vive en el dashboard/DB (horarios, servicios, FAQs, WhatsApp, Calendar, tono del asistente), no en forks de código por vertical.

Stack: **NestJS + Prisma + PostgreSQL/pgvector + Redis** · **Next.js + Tailwind** · **pnpm** workspaces · OpenAI (abstracción lista para otros providers).

## Arquitectura

```
apps/api     Agent Core, tools, RAG, WhatsApp, Calendar/citas, inbox, observabilidad
apps/admin   Dashboard, conversaciones, conocimiento, integraciones, playground
```

Piezas clave:

- **Agent Core**: mensaje → memoria → RAG → LLM → tools → respuesta
- **PromptBuilder**: identidad, negocio, horarios, servicios, mensajes y tools dinámicos
- **Tools**: info, horarios, servicios, disponibilidad, citas, leads, handoff, email, n8n
- **Canales**: Web + WhatsApp vía [WAHA](https://waha.devlike.pro/) (REST + webhooks; abstracción lista para Meta Cloud)
- **Citas**: fuente de verdad local + sync opcional con Google Calendar
- **Conocimiento**: FAQ en texto / PDF / MD → embeddings pgvector
- **Observabilidad**: `AgentExecution` + `ToolExecution` + Playground debug

## Requisitos

- Node 22+
- pnpm 10+
- Docker (recomendado)

## Setup local (rápido)

```bash
pnpm install
cp .env.example .env
# Completá OPENAI_API_KEY, ADMIN_API_KEY, ENCRYPTION_KEY

pnpm docker:infra          # Postgres + Redis + WAHA
pnpm db:generate
pnpm db:deploy
pnpm db:seed

pnpm dev:api               # http://localhost:3001/api/health
pnpm dev:admin             # http://localhost:3000
```

Admin: header `x-api-key` = `ADMIN_API_KEY` (también `NEXT_PUBLIC_ADMIN_API_KEY`).

## Docker (stack completo)

Levanta **postgres + redis + api + admin + WAHA**:

```bash
cp .env.example .env
# Completá secretos (mínimo OPENAI_API_KEY, ADMIN_API_KEY, ENCRYPTION_KEY)

pnpm docker:up
# o: docker compose up -d --build
```

URLs:

| Servicio | URL |
| --- | --- |
| Admin | http://localhost:3000 |
| API health | http://localhost:3001/api/health |
| WAHA (Swagger/Dashboard) | http://localhost:3002 |
| WhatsApp webhook (WAHA → Nest) | http://localhost:3001/api/webhooks/waha |
| Realtime (Socket.IO) | `ws://localhost:3001/realtime` |
| Google OAuth callback | http://localhost:3001/api/oauth/google/callback |

Seed del negocio demo (después de que la API esté healthy):

```bash
pnpm docker:seed
# o: docker compose exec api pnpm prisma:seed
```

Logs / stop:

```bash
pnpm docker:logs
pnpm docker:down
```

### Notas Docker

- `NEXT_PUBLIC_API_URL` debe ser alcanzable **desde el navegador** (ej. `http://localhost:3001/api`), no el hostname interno `api`.
- En Docker, configurá WAHA en Admin con URL interna `http://waha:3000` (la API habla con WAHA). Swagger local: http://localhost:3002.
- Con API en el host y WAHA en Docker, usá `WAHA_WEBHOOK_URL=http://host.docker.internal:3001/api/webhooks/waha`.
- En producción cambiá `API_URL`, `ADMIN_URL`, `NEXT_PUBLIC_*` y `GOOGLE_REDIRECT_URI` al dominio público.
- Rebuild del admin si cambiás `NEXT_PUBLIC_*` (van bakeadas en el build).
- Solo infra local: `pnpm docker:infra` (postgres + redis + waha).

## Deploy por negocio (plantilla)

1. Cloná el repo (o una rama/release estable).
2. Creá un `.env` propio con secretos y URLs públicas.
3. Provisional: `docker compose up -d --build` en un VPS, o adaptá a tu orquestador (Fly, Railway, ECS, etc.) usando los mismos Dockerfiles.
4. Corré migraciones (el contenedor `api` ya ejecuta `prisma migrate deploy` al arrancar).
5. Seed inicial o creá el negocio desde el admin.
6. Conectá WhatsApp / Google Calendar desde **Integraciones**.
7. Cargá FAQs en **Conocimiento** y revisá horarios/servicios.

Un deployment = un negocio. No es multi-tenant SaaS.

## Variables de entorno

Ver `.env.example` completo. Resumen:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | locks, rate limit, BullMQ |
| `OPENAI_API_KEY` | chat + embeddings |
| `ENCRYPTION_KEY` | secrets (WhatsApp, Calendar, integrations) |
| `ADMIN_API_KEY` / `NEXT_PUBLIC_ADMIN_API_KEY` | panel admin |
| `NEXT_PUBLIC_API_URL` | base URL del admin → API (`…/api`) |
| `WAHA_BASE_URL` / `WAHA_API_KEY` | cliente Nest → WAHA |
| `WAHA_WEBHOOK_URL` | WAHA → Nest (`/api/webhooks/waha`) |
| `GOOGLE_CLIENT_*` / `GOOGLE_REDIRECT_URI` | OAuth Calendar |

Nunca commitees `.env` real.

## Flujos útiles

### WhatsApp (WAHA)

Admin → **Integraciones → WhatsApp**: URL de WAHA, API key, iniciar sesión, escanear QR.
El estado/QR y los mensajes del inbox se actualizan por WebSocket (Nest → Dashboard).

Flujo: `WhatsApp → WAHA → Nest → Agent Core → WahaWhatsAppProvider → WAHA → WhatsApp`.

### Conversaciones

Admin → **Conversaciones**: bandeja tipo WhatsApp, pause/resume/close, reply humano (tiempo real vía WebSocket).

### Citas

Tools del agente + Admin → **Calendario**. Sin Google sigue funcionando en modo local (horarios del negocio).

### Conocimiento

Admin → **Conocimiento**: FAQs en texto o archivos. Reindexá si el seed quedó sin embeddings.

### Playground

Admin → **Playground**: timeline de tools, RAG, prompt, tokens, costo, historial de ejecuciones.

### Chat API

```bash
curl -X POST http://localhost:3001/api/chat/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -d '{
    "businessId": "<id>",
    "message": "Hola, quiero un turno",
    "debug": true
  }'
```

## Tests

```bash
pnpm test
```

## Principios

- Template por negocio, no SaaS multi-tenant
- Config en DB/dashboard, no forks por vertical
- Tipado fuerte + Zod
- Sin LangChain
- Secrets cifrados, nunca al LLM
- Observabilidad de ejecuciones y tools
