# 10 · Roadmap de implementación

Este documento es la guía de Claude Code en el servidor. Cada sprint termina con algo desplegable y testeable. **No saltarse sprints.**

## Filosofía

- **Vertical slice**: cada sprint añade un end-to-end completo, no capas horizontales.
- **Testeable**: cada feature tiene test antes del próximo sprint.
- **Reversible**: si algo no funciona, se puede volver al anterior con git revert.
- **Documentado**: ADRs para decisiones que se desvíen de los docs.

## Sprint 0: bootstrapping (medio día)

Solo la primera vez. Skip si ya está hecho.

- [ ] Crear repo en GitHub, subir todos los markdown de `/docs`.
- [ ] Inicializar monorepo con pnpm workspaces:
  ```
  /apps/api
  /packages/shared
  /packages/db
  ```
- [ ] `tsconfig.json` base estricto, lint con Biome o ESLint + Prettier, husky pre-commit, gitleaks.
- [ ] CI básico (GitHub Actions): typecheck + lint + test al hacer push.
- [ ] VPS con Docker, Caddy, Postgres, Redis, n8n queue mode arrancados.
- [ ] DNS apuntando a `api.midominio.com`, `n8n.midominio.com`, `admin.midominio.com`.

**Done cuando**: `git clone && docker compose up` levanta n8n + Postgres + Redis sin la API todavía.

## Sprint 1: MVP "happy path" (5-7 días)

Objetivo: un mensaje en Instagram dispara una respuesta del agente, con debounce real funcionando.

### Código

- [ ] Esquema Postgres mínimo: `tenants`, `subscribers`, `messages_raw`, `conversations`, `turns`. Migrar con drizzle-kit.
- [ ] `apps/api/src/server.ts` con Fastify, `/healthz`, `/readyz`, `/metrics`.
- [ ] Plugin de logger Pino con correlation_id.
- [ ] `POST /webhook/manychat` con:
  - Verificación de `X-MC-Token`
  - Validación con Zod
  - Idempotencia con Redis SET NX EX
  - Insert en `messages_raw`
  - Push al buffer Redis (Lua atómico)
  - Encolar job BullMQ con delay
  - Respuesta 200 inmediata
- [ ] `apps/api/src/worker.ts`: BullMQ worker que procesa `process-batch`:
  - Verifica token de cancelación
  - Adquiere lock
  - Drena buffer
  - Crea turn pending
  - HTTP POST a n8n webhook
- [ ] `POST /admin/turn-completed`: cierra turn, libera lock, relanza si hay buffer.
- [ ] Tests unitarios del Lua de debounce y del lock.

### Configuración

- [ ] Crear primer tenant manualmente en Postgres con `slug='dev'`, `config` con valores default.
- [ ] Configurar External Request en ManyChat → `https://api.midominio.com/webhook/manychat` con header `X-MC-Token`.

### n8n

- [ ] Workflow "agent-run":
  - Webhook trigger (URL configurada en `tenants.config.n8n_workflow_url`)
  - Respond Immediately con 202
  - AI Agent node con OpenAI / Claude (sin tools todavía, solo prompt simple)
  - HTTP Request → ManyChat sendFlow para enviar respuesta
  - HTTP Request → callback a `/admin/turn-completed` con tokens consumidos

### Validación

- [ ] Test manual: enviar 3 DMs en 5 segundos a la cuenta de Instagram conectada. Esperar 8 segundos. Verificar:
  - 3 filas en `messages_raw`
  - 1 fila en `turns` con `batch_size=3`
  - 1 fila en `conversations`
  - El usuario recibe **una sola** respuesta del agente.

**Done cuando**: el flujo end-to-end funciona con un único tenant y un único agente simple.

## Sprint 2: producción (5-7 días)

Objetivo: estable, multi-tenant, con DLQ y rate limit.

### Código

- [ ] Multi-tenancy: RLS en Postgres, `tenant_slug` en payload, validación.
- [ ] Rate limiter (sliding window) por subscriber con Lua.
- [ ] DLQ: tabla + worker que mueve jobs fallidos tras N reintentos.
- [ ] Reintentos BullMQ con backoff exponencial (`attempts: 5, backoff: { type: 'exponential', delay: 1000 }`).
- [ ] Circuit breaker (`opossum` o similar) en la llamada HTTP a n8n.
- [ ] Endpoints admin:
  - `GET/POST /admin/tenants`, `GET/PATCH /admin/tenants/:id`
  - `GET /admin/subscribers`, `GET /admin/subscribers/:id`
  - `POST /admin/subscribers/:id/pause` y `unpause`
  - `DELETE /admin/subscribers/:id/buffer`
  - `GET /admin/turns`, `POST /admin/turns/:id/retry`
  - `GET /admin/dlq`, `POST /admin/dlq/:id/retry`, `POST /admin/dlq/:id/resolve`
  - `GET /admin/stats/overview`
- [ ] JWT admin con dos roles (`admin`, `n8n`).
- [ ] Cron `purge-old-data` diario.
- [ ] Tests integración con docker-compose en CI.

### n8n

- [ ] Workflow administrativo "DLQ Daily Review" (cron + Slack).
- [ ] Workflow "Inspector de usuario" (manual trigger con form).
- [ ] Workflow agente con tools básicas (memoria Redis Chat Memory, lookup en Postgres del subscriber).

### Documentación

- [ ] Generar OpenAPI spec, importar en n8n para autocompletar HTTP Request nodes.
- [ ] Doc de "cómo crear un tenant nuevo" en `/docs/runbooks/`.

**Done cuando**: 2-3 tenants distintos pueden operar sin pisarse, los fallos van a DLQ visible, y un workflow de n8n puede pausar un usuario llamando a la API.

## Sprint 3: observabilidad y dashboard (4-6 días)

### Métricas y dashboards

- [ ] `prom-client` con todas las métricas de `08-observabilidad-y-dashboard.md`.
- [ ] Endpoint `/metrics` (interno).
- [ ] Servicios Prometheus + Grafana en docker-compose.
- [ ] Dashboards Grafana exportados a JSON y guardados en `/infra/grafana/dashboards/`.
- [ ] Alertas básicas con Grafana Alerting → Telegram bot.

### Bull Board

- [ ] Integrar `@bull-board/fastify` en `/admin/queues` con auth admin.

### Sentry

- [ ] Integrar Sentry en API y workers.
- [ ] Sourcemaps subidos en CI.

### Admin web (opcional, decidir aquí)

Decidir según uso real:
- Si los workflows n8n bastan → no construir admin web todavía.
- Si necesitas UI bonita → SvelteKit en `apps/admin`.

**Done cuando**: a las 3 a.m. un fallo de DLQ te llega al móvil con suficiente contexto para decidir si actuar o esperar.

## Sprint 4: features avanzadas (incremental)

Sprints siguientes según prioridades de negocio. Algunas ideas:

- [ ] Manejo de medios: descarga, almacenamiento S3/R2, paso al LLM con visión.
- [ ] Memoria larga con pgvector (resúmenes embebidos).
- [ ] Versionado de prompts en Postgres (`prompt_versions` + selección por tenant).
- [ ] Eval pipeline con Langfuse para medir calidad de respuestas.
- [ ] A/B testing de prompts.
- [ ] Handoff a humano con notificación a Slack/Teams.
- [ ] Marketing messages opt-in flow.
- [ ] Replicación Postgres / Redis para HA.
- [ ] Tests de carga con k6.
- [ ] Cliente WhatsApp/Telegram (extender el adaptador del webhook).

## Reglas para Claude Code en cada sprint

1. **Confirmar el sprint actual con el founder antes de tocar código**.
2. **Leer los docs relevantes** del sprint antes de empezar.
3. **Plan claro antes del código**: lista los archivos que vas a crear/modificar.
4. **Commits pequeños**: una feature = uno o pocos commits, con mensajes descriptivos.
5. **Tests al mismo tiempo que el código**, no después.
6. **No introducir dependencias nuevas** sin justificarlo en un ADR.
7. **Si descubres algo que contradice la doc**: para, escribe un ADR, propón cambio, espera confirmación.
8. **Logs estructurados desde el primer commit**, no añadir después.
9. **Variables de entorno** documentadas en `.env.example` siempre actualizado.
10. **Migraciones reversibles**: cada `up` con su `down`.

## Estimación de esfuerzo total

Como solo founder con IA asistente y formación técnica:

| Sprint | Tiempo realista |
|---|---|
| 0 | 0.5 día |
| 1 | 5-7 días (curva inicial) |
| 2 | 5-7 días |
| 3 | 4-6 días |
| 4+ | Continuo, según necesidad |

**~3 semanas hasta producción real.** Evitar la trampa de optimizar en sprint 1 lo que no se sabe si dolerá.

## Definition of Done global (antes de "production-ready")

- [ ] El sistema arranca con `docker compose up -d` desde cero en un VPS limpio.
- [ ] Existe un runbook de "qué hacer si X" para los 5 fallos más probables.
- [ ] Tests E2E pasan en CI.
- [ ] Backups automáticos verificados (no basta con que se ejecuten, hay que probar restore).
- [ ] Hay 2 tenants reales operando >7 días sin intervención.
- [ ] Coste mensual modelado y verificado dentro del presupuesto.
- [ ] Un postmortem real escrito tras el primer incidente.

## Antipatrones a evitar en el roadmap

- ❌ "Vamos a montar todo el observability stack antes de tener un solo mensaje pasando" → Sprint 1 primero.
- ❌ "Vamos a hacer el admin web ahora porque queda bonito" → solo si los workflows n8n no bastan.
- ❌ "Vamos a soportar WhatsApp ya por si acaso" → solo cuando un cliente lo pague.
- ❌ "Vamos a usar microservicios" → No. Un monolito Fastify es suficiente para años.
- ❌ "Vamos a meter Kubernetes" → No. Docker Compose en un VPS gestiona perfectamente este volumen.
- ❌ "Cambiamos a Bun/Deno/Rust porque es más rápido" → No es el cuello de botella.
