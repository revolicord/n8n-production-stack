# ADR-0021 — Consolidación del panel admin en el dashboard Next.js (`/settings`)

- **Fecha:** 2026-05-29
- **Estado:** Aceptado / Implementado
- **Contexto previo:** ADR-0018 (followup messages + MinIO), ADR-0019 (agent resources)

## Contexto

Convivían **dos paneles con sesiones independientes**:

1. **SPA legacy** en `api.revolicord.com/dashboard` — `apps/api/public/` (vanilla JS + Tailwind CDN),
   servido por Fastify con `@fastify/static`. Auth: JWT de 12 h en `localStorage`, emitido por
   `POST /admin/login` (password → token). Editaba funnel-stages, followup-templates,
   followup-messages, agent-resources (general/cierre/objeción) y uploads.
2. **Dashboard Next.js** en `dashboard.revolicord.com` — `apps/dashboard/` (Next 15 + React 19, RSC +
   Drizzle directo, sesión `panel_session` en cookie HttpOnly de 30 días). Analytics y prospectos.
   Su sidebar enlazaba al SPA como "Settings" externo.

Dos dominios, dos cookies, dos logins, doble mantenimiento. El SPA además metía vanilla JS en un
monorepo TS estricto (`noExplicitAny` es error en Biome) y arrastraba el CDN de Tailwind.

## Decisión

Reescribir el SPA como **rutas nativas `/settings/*`** del dashboard Next.js. Una sola UI, una sola
sesión. El API Fastify vuelve a ser **solo JSON** (para n8n y el proxy admin).

### Camino de datos: mixto
- **Lecturas:** Drizzle directo desde RSC (`apps/dashboard/src/lib/{resources,followups}.ts`).
- **Escrituras:** Server Actions (`settings/_actions/`) → API `/admin/*` vía `lib/admin-api.ts`.

Motivo de no duplicar la lógica en Server Actions: los handlers del API tienen invariantes no
triviales (state machine `VALID_TRANSITIONS`, `isTypeConsistent` en followups/messages, catch de
`23505` para unique constraints) y n8n sigue consumiendo `/admin/turn-completed`,
`/admin/system-event` y `/admin/leads/:id/stage`. Esos endpoints viven sí o sí; reimplementar la
validación sería deuda inmediata.

### Auth del proxy admin
El proxy genérico `apps/dashboard/src/app/api/admin/[...path]/route.ts`:
1. Valida la cookie `panel_session` (sesión del dashboard).
2. **Re-firma** un JWT corto (TTL 5 min, `role:'admin'`) con `ADMIN_JWT_SECRET` — el mismo secreto
   que usa el API.
3. Reenvía a `INTERNAL_API_URL` (`http://n8n_api:3000` en prod) con `Authorization: Bearer <jwt>`,
   incluido `multipart/form-data` para uploads.

El navegador nunca ve el token de admin, solo su cookie de panel. El API solo **verifica** el JWT
(`lib/admin-auth.ts`, Camino 2); ya no emite tokens.

### Por qué no iframe ni portar vanilla JS
- **iframe:** duplica sesiones cross-domain y deja doble sidebar.
- **Portar `app.js`:** mete vanilla JS en un monorepo TS estricto y arrastra el CDN de Tailwind.
- **Reescritura nativa:** única opción que paga futuro (componentes reutilizables, RSC, una sesión).

## Consecuencias

### Añadido (`apps/dashboard/`)
- Proxy `api/admin/[...path]/route.ts`; helpers `lib/admin-api.ts`, `lib/auth.ts::signAdminToken`,
  `lib/resources.ts`, `lib/followups.ts`, `lib/upload-client.ts`.
- Server Actions `settings/_actions/{resources,followups}.ts`.
- Rutas `settings/{general,cierres,objeciones,fase-b,fase-c}` + layout con tabs + `ToastHost`.
- Componentes `ResourcesEditor`, `StageEditor`, `ImageField`, `PlaceholderTextarea`, `SettingsTabs`.
- Sidebar: "Settings" ahora es enlace interno a `/settings`.

### Retirado (`apps/api/`)
- `apps/api/public/` (SPA completo).
- `@fastify/static` + redirect `/dashboard` en `server.ts`.
- `POST /admin/login` (`routes/admin/login.ts` + test) y la env `ADMIN_PASSWORD` (config + stack).
- Helmet CSP endurecida (`default-src 'none'`) — el API ya no renderiza HTML.

### Infra
- El servicio `n8n_dashboard` necesita `ADMIN_JWT_SECRET` (mismo valor que `n8n_api`) +
  `INTERNAL_API_URL=http://n8n_api:3000`. Añadidos a `docker-stack.yml`. **Sin estas envs el proxy
  devuelve 401.**

### Fuera de alcance
- `set-stage` y `system-event` siguen siendo n8n-only: no son superficie de panel.
- El selector multi-tenant del panel usa `getActiveTenant()` (primer tenant activo), consistente con
  el resto del dashboard.

## Verificación (2026-05-29, prod)
Login `200` + cookie → proxy con cookie `200` (`/admin/tenants` devuelve JSON), sin cookie `307`
a `/login`. Todas las páginas `/settings/*` responden `200`. Uploads multipart por el proxy OK.
