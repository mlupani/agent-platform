# Deploy guide — Agent Platform

## Opción A: Docker Compose en un VPS

1. Instalá Docker + Compose.
2. Cloná el repo en el servidor.
3. `cp .env.example .env` y completá:
   - `OPENAI_API_KEY`
   - `ADMIN_API_KEY` / `NEXT_PUBLIC_ADMIN_API_KEY` (mismo valor)
   - `ENCRYPTION_KEY` (≥ 32 chars)
   - URLs públicas: `API_URL`, `ADMIN_URL`, `NEXT_PUBLIC_API_URL`, `GOOGLE_REDIRECT_URI`
4. `docker compose up -d --build`
5. `docker compose exec api pnpm prisma:seed` (opcional)
6. Abrí el admin, conectá WhatsApp/Calendar y cargá conocimiento.

Reverse proxy sugerido (Caddy/Nginx/Traefik):

- `https://app.tudominio.com` → `admin:3000`
- `https://api.tudominio.com` → `api:3001`

Si usás subdominios, actualizá CORS vía `ADMIN_URL` y los `NEXT_PUBLIC_*`.

## Opción B: Infra local + procesos Node

```bash
pnpm docker:infra
pnpm install
pnpm db:deploy && pnpm db:seed
pnpm dev:api
pnpm dev:admin
```

Útil para desarrollo diario.

## Checklist post-deploy

- [ ] `GET /api/health` responde ok
- [ ] Login/admin con `x-api-key` funciona
- [ ] Seed o negocio creado
- [ ] OPENAI responde en Playground
- [ ] WAHA levantado; webhook `WAHA_WEBHOOK_URL` apunta a Nest `/api/webhooks/waha`
- [ ] Admin → Integraciones: sesión WAHA conectada (QR escaneado)
- [ ] Google OAuth redirect registrado (si aplica)
- [ ] Backup de Postgres configurado

## Un cliente = un stack

No compartas la misma DB entre negocios. Cada cliente tiene su compose/env/DB.
