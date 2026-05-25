# Quantum Setting Dashboard — Runbook de deploy en producción

Documento generado tras la implementación completa (8 pasos, 2026-05-22).  
**NO tocar producción hasta leer este documento de principio a fin.**

---

## A — Qué se implementó

| Commit | Descripción |
|--------|-------------|
| `feat(db): rename delay_hours to delay_minutes` | SQL escrito a mano (RENAME + UPDATE ×60). Schema Drizzle, servicios, rutas, tests, docs n8n y seed actualizados. Migración `0009_delay_minutes.sql`. |
| `feat(api): list funnel stages by tenant` | `listFunnelStages()` en `services/followups.ts` + `GET /admin/tenants/:tenantId/funnel-stages`. |
| `fix(api): enforce text/image invariant on followup-messages PUT; add CORS` | PUT de followup-messages verifica tipo/campo contra fila existente antes de actualizar. Registra `@fastify/cors`. |
| `feat(api): add agent_resources table and CRUD` | Migración `0010_agent_resources.sql`, schema Drizzle, service completo, 4 endpoints REST, tests Zod, `docs/adr/0019-agent-resources.md`, `docs/api/agent-resources.md`. |
| `feat(api): JWT login for admin dashboard with backwards-compatible bearer` | `POST /admin/login` (password → JWT 12 h). `lib/admin-auth.ts` con dual-auth: bearer estático para n8n OR JWT para dashboard. `@fastify/jwt`. Todos los route files admin migrados. |
| `chore(infra): auto-create public MinIO bucket on setup` | `scripts/init-minio-bucket.sh` idempotente (usa `docker run minio/mc`). Integrado en `setup.sh` antes del banner final. |
| `feat(dashboard): vanilla SPA served from Fastify under /dashboard` | `@fastify/static` en `server.ts`. `GET /admin/tenants`. `apps/api/public/` (index.html, app.js, styles.css, favicon.svg). `Dockerfile` actualizado con `COPY ... public`. |
| `docs: dashboard smoke checklist and update top-level README` | `docs/api/dashboard-smoke.md` (11 pasos de smoke e2e). `docs/api/README.md` ampliado con nuevos endpoints y auth dual. Nota de implementación en ADR-0018. Sección "Dashboard" en `README.md` raíz. |

### Nuevos archivos

```
packages/db/drizzle/
  0009_delay_minutes.sql          — RENAME delay_hours → delay_minutes + ×60
  0010_agent_resources.sql        — CREATE TABLE api.agent_resources + índices

apps/api/src/
  lib/admin-auth.ts               — verifyAdminAuth (dual-auth)
  routes/admin/login.ts           — POST /admin/login
  routes/admin/login.test.ts
  routes/admin/tenants.ts         — GET /admin/tenants
  routes/admin/agent-resources.ts — CRUD /admin/(tenants/:id|agent-resources/:id)/agent-resources
  routes/admin/agent-resources.test.ts
  routes/admin/followup-messages.test.ts

apps/api/public/
  index.html   — SPA completa
  app.js       — lógica JS (login, stages, templates, resources, uploads)
  styles.css   — overrides Tailwind
  favicon.svg

scripts/
  init-minio-bucket.sh   — crea bucket 'assets' con descarga anónima

docs/api/
  agent-resources.md
  dashboard-smoke.md
  dashboard-deploy-runbook.md  ← este archivo

docs/adr/
  0019-agent-resources.md
```

---

## B — Pasos de deploy en producción

> **Orden estricto. Parar ante cualquier error.**

### B1 — Pull del código

```bash
cd /opt/n8n-production
git pull origin master
```

### B2 — Añadir nuevas variables al `.env`

```bash
# Editar .env y añadir las dos líneas nuevas:
ADMIN_PASSWORD=<mínimo 8 chars — la contraseña que usará Alex en el dashboard>
ADMIN_JWT_SECRET=<mínimo 32 chars — generar con: openssl rand -hex 32>
```

> No compartir `ADMIN_JWT_SECRET` con nadie. Solo sirve para firmar los tokens internos.

### B3 — Aplicar migraciones de BD

```bash
make migrate
# Aplica 0009_delay_minutes.sql:
#   ALTER TABLE api.followup_templates RENAME COLUMN delay_hours TO delay_minutes;
#   UPDATE api.followup_templates SET delay_minutes = delay_minutes * 60;
# Aplica 0010_agent_resources.sql:
#   CREATE TABLE api.agent_resources + índices
```

Verificar que ambas migraciones se aplicaron:

```bash
make logs-api | grep -E "(migration|0009|0010)"
# Debe aparecer: "migrations applied"
```

> ⚠️ **Ventana de inconsistencia:** entre `make migrate` y que la nueva imagen arranque, la BD tiene `delay_minutes` pero la imagen anterior busca `delay_hours`. La ventana es breve (segundos) — si tienes alta disponibilidad, drena el tráfico primero.

### B4 — Reconstruir y redesplegar la API

```bash
make rebuild-api
# Equivale a:
#   docker build -f apps/api/Dockerfile -t dm-api:local .
#   docker service update --image dm-api:local n8n_dm-api
#   docker service update --image dm-api:local n8n_dm-api-worker
```

Esperar hasta que ambos servicios estén `Running`:

```bash
make status
# dm-api       1/1  Running
# dm-api-worker 1/1 Running
```

### B5 — Crear bucket MinIO (si no existe)

```bash
bash scripts/init-minio-bucket.sh
# Idempotente, seguro re-ejecutar si ya existe
```

### B6 — Smoke test rápido

```bash
export API_HOST=<tu dominio, ej: api.revolicord.com>
export ADMIN_PASSWORD=<la que pusiste en .env>

# Healthz
curl -s -o /dev/null -w "%{http_code}" https://$API_HOST/healthz
# → 200

# Dashboard carga
curl -s -o /dev/null -w "%{http_code}" https://$API_HOST/dashboard/
# → 200

# Login con password correcto → JWT
TOKEN=$(curl -s -X POST https://$API_HOST/admin/login \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .token)
echo "${TOKEN:0:10}"
# → eyJhbGci... (primeros 10 chars del JWT)

# Bearer estático de n8n sigue funcionando
curl -s "https://$API_HOST/admin/tenants" \
  -H "Authorization: Bearer $N8N_CALLBACK_TOKEN" | jq '.tenants | length'
# → número ≥ 1
```

Checklist completo de 11 pasos: [`dashboard-smoke.md`](./dashboard-smoke.md)

### B7 — Dar acceso a Alex

Enviarle:
- URL: `https://<API_HOST>/dashboard`
- Contraseña: el valor de `ADMIN_PASSWORD` del `.env`

El JWT dura 12 h; el login overlay reaparece automáticamente al expirar.

---

## C — Lo que NO debes hacer

| Prohibido | Por qué |
|-----------|---------|
| Tocar `N8N_ENCRYPTION_KEY` o cualquier var cifrada de n8n | Invalidaría todas las credenciales almacenadas en n8n |
| Borrar tablas o columnas | Todas las migraciones son ADD/RENAME/CREATE — no destructivas |
| Deployar la nueva imagen SIN haber corrido `make migrate` | La API 0.7.x usa `delay_minutes`; la BD anterior tiene `delay_hours` — falla en boot |
| Correr `pnpm db:generate` sin revisar el SQL | Drizzle puede generar DROP+ADD en vez de RENAME (ver comentario en `0009_delay_minutes.sql`) |
| Editar los JSON de n8n workflows directamente | Solo editar los `.md` de spec en `docs/n8n/workflows/` |

---

## D — Deuda técnica (12 issues para el backlog)

| # | Issue | Módulo | Prioridad |
|---|-------|--------|-----------|
| 1 | `GET /admin/tenants` sin paginación | `routes/admin/tenants.ts` | Baja |
| 2 | `seed_qc_funnel.sql` no se aplica automáticamente — requiere UUID manual | `packages/db/drizzle/` | Media |
| 3 | `addMessage` usa `prompt()` nativo para tipo e imagen — UX pobre | `apps/api/public/app.js` | Media |
| 4 | Errores de red (fetch rechazado sin `.status`) no capturados — bloquea la UI silenciosamente | `apps/api/public/app.js` | Alta |
| 5 | Sin paginación en follow-up templates por etapa | `routes/admin/followups.ts` | Baja |
| 6 | `ADMIN_PASSWORD` con `timingSafeEqual` trunca passwords > 64 bytes silenciosamente | `routes/admin/login.ts` | Media |
| 7 | JWT sin refresh token — sesión cae dura a las 12 h, sin renovación silenciosa | `lib/admin-auth.ts` | Baja |
| 8 | `@fastify/cors` en producción pone `origin: false` — no permite acceso cross-origin si se quisiera separar el frontend en el futuro | `server.ts` | Baja |
| 9 | `agent_resources.updated_at` actualizado con `new Date()` del proceso, no trigger de BD — posible skew con múltiples instancias | `services/agent-resources.ts` | Baja |
| 10 | Sin tests de integración para los endpoints nuevos — solo tests de Zod schemas | `routes/admin/*.test.ts` | Alta |
| 11 | Bucket MinIO totalmente público de lectura, sin expiración de URLs ni rotación | `lib/minio.ts` | Baja |
| 12 | `docs/api/README.md` no tiene ejemplos request/response para `GET /admin/tenants` ni `GET /admin/funnel-stages` | `docs/api/README.md` | Baja |

### Deuda adicional encontrada durante la ejecución

- **`0001_lead_stages.sql` fuera del journal Drizzle** — existe en `packages/db/drizzle/` pero no está registrado en `meta/_journal.json`. En un entorno limpio real, `pnpm db:migrate` no lo aplica y una generación posterior podría intentar recrear sus tablas. Solución: añadir `0001` al journal con el timestamp correcto.
- **`__dirname` con `import.meta.url` en `server.ts`** — funciona correctamente con `tsx` (dev), `tsc` (build) y la imagen Docker actual. Si en el futuro se compila con `tsup` a un bundle único en ubicación distinta, verificar que `resolve(__dirname, '..', 'public')` sigue apuntando a `apps/api/public/`.

---

*Generado automáticamente por Claude Code al final de la sesión de implementación del dashboard.*
