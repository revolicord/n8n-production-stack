# 03 — Arquitectura técnica

## Resumen

```
                              ┌─────────────────────────────┐
                              │  paneln8n.revolicord.com    │
                              │  (n8n queue mode + UI)      │
                              └─────────────────────────────┘
                                          ▲ (read/write)
                                          │
┌──────────────────────────┐    ┌─────────────────────────────┐
│ ManyChat / Instagram     │───▶│ api.revolicord.com (Fastify)│
│ webhooks                 │    │  + SPA admin en /dashboard   │
└──────────────────────────┘    └─────────────────────────────┘
                                          │
                                          ▼ (writes)
                              ┌─────────────────────────────┐
                              │ Postgres  (schema = api)    │
                              │  multi-tenant               │
                              └─────────────────────────────┘
                                          ▲ (read-only)
                                          │
                              ┌─────────────────────────────┐
                              │ dashboard.revolicord.com    │
                              │ Next.js 15 (este paquete)   │
                              └─────────────────────────────┘
                                          ▲
                                          │
                                       Alex 👤
```

**Lo crítico:** el panel **solo lee**. No escribe en Postgres. No llama a Fastify. No interactúa con n8n. Sus únicas dependencias son **Postgres** (vía Drizzle) y su **propia cookie de auth** (JWT firmado con su propio secret).

## Stack definitivo

| Capa | Tecnología | Versión | Razón |
|---|---|---|---|
| Runtime | Node | 20 LTS | Mismo que el resto del repo |
| Gestor de paquetes | pnpm | 9+ | Workspaces ya configurados |
| Framework | Next.js | 15.x (App Router) | Server Components + Server Actions |
| Lenguaje | TypeScript | estricto | Igual que el resto del repo |
| UI | React | 19 | Viene con Next 15 |
| Estilos | Tailwind CSS | 3.4.x | Coherente con SPA admin que usa Tailwind CDN |
| DB ORM | Drizzle | misma versión que `packages/db` | Reuso |
| Driver PG | `pg` o `postgres` | mismo que `packages/db/src/client.ts` | Reuso |
| Auth | JWT manual + cookie httpOnly | `jose` | Liviano, sin NextAuth |
| Icons | `@tabler/icons-react` | latest | Tabler outline |
| Animaciones (Sprint 2) | `framer-motion` | 11.x | Solo en Sprint 2+ |
| Testing | vitest + Testing Library | misma que el resto | Coherente |
| Lint | Biome | mismo que el resto | Reuso de `biome.json` raíz |

**No instalar:**

- ❌ NextAuth (overkill).
- ❌ Recharts / Tremor / Chart.js (Sprint 1–2 dibuja todo con SVG nativo o divs/CSS).
- ❌ Zustand / Redux / Jotai (estado server-side con Server Components, mínimo cliente).
- ❌ shadcn/ui en Sprint 1 (añade complejidad; los componentes son pocos y se hacen a mano).
- ❌ Vercel SDK / next-auth / iron-session.

## Conexión a Postgres (lo crítico bien hecho)

### Reuso del package `@revolicord/db`

El monorepo ya tiene `packages/db/` con:

- `src/schema.ts` — la fuente de verdad del schema Drizzle.
- `src/client.ts` — el cliente Drizzle ya configurado con pooling.
- `src/index.ts` — re-exports.

El package se llama (según el `package.json` del workspace) `@revolicord/db` o similar — comprobar y usar el nombre real.

### Uso en Next.js

En `apps/dashboard/src/lib/db.ts`:

```ts
import { db } from '@revolicord/db';
export { db };
export * from '@revolicord/db/schema'; // re-export tablas y tipos
```

En cualquier Server Component o Route Handler:

```ts
import { db, subscribers, stageTransitions } from '@/lib/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

export default async function YearViewPage({ params }: { params: { year: string } }) {
  const tenantId = await getActiveTenantId();
  const rows = await db
    .select({ stage: subscribers.id })
    .from(subscribers)
    .where(eq(subscribers.tenantId, tenantId));
  return <YearView data={rows} />;
}
```

### Pooling y `DATABASE_URL`

El panel debe usar **la misma `DATABASE_URL`** que la API Fastify (mismo Postgres, mismo schema `api`). Pero **un pool propio** para no compartir conexiones entre apps.

En `apps/dashboard/src/lib/db.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@revolicord/db/schema';

const queryClient = postgres(process.env.DATABASE_URL!, {
  max: 10,              // pool más pequeño que la API
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export * from '@revolicord/db/schema';
```

> Si `packages/db` usa otro driver (`pg` en vez de `postgres-js`), copiar su patrón exacto. **No mezclar drivers** — comprobar `packages/db/src/client.ts` antes de escribir esto.

### Caché de queries

Next.js 15 cachea fetch automáticamente pero **no las llamadas Drizzle**. Para el dashboard analítico es **deseable** que no se cacheen agresivamente (Alex quiere datos frescos).

Estrategia:

- **Server Components**: leen en cada request. Sin cache.
- **Headers de respuesta**: cada page export con `export const revalidate = 30;` (cada 30s revalida en background).
- **Sin SWR / sin React Query** en Sprint 1. Recarga manual (`router.refresh()`) si Alex pulsa un botón de "actualizar".

## Subdominio y deploy

### DNS

`dashboard.revolicord.com` → A record que apunte a la IP del servidor Swarm donde corre Traefik.

### Traefik routing

El stack ya usa Traefik con TLS automático Let's Encrypt. Añadir labels al servicio del dashboard en `docker-stack.yml`:

```yaml
services:
  dashboard:
    image: ghcr.io/revolicord/dashboard:latest
    networks:
      - traefik-public
    environment:
      DATABASE_URL: ${DATABASE_URL}
      PANEL_PASSWORD: ${PANEL_PASSWORD}
      PANEL_JWT_SECRET: ${PANEL_JWT_SECRET}
      NODE_ENV: production
    deploy:
      replicas: 1
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.dashboard.rule=Host(`dashboard.revolicord.com`)"
        - "traefik.http.routers.dashboard.entrypoints=websecure"
        - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
        - "traefik.http.services.dashboard.loadbalancer.server.port=3000"
```

Ver doc 11 para el Dockerfile completo y el runbook.

## Estructura del monorepo después de añadir el panel

```
n8n-production-stack/
├── apps/
│   ├── api/                  ← existente, Fastify + SPA admin
│   └── dashboard/            ← NUEVO, este paquete construye aquí
├── packages/
│   ├── db/                   ← existente, reusado por panel
│   └── shared/               ← existente, NO se usa en panel (Sprint 1)
├── n8n/                      ← existente, no se toca
├── docs/
│   ├── adr/                  ← existente
│   ├── api/                  ← existente, NO confundir con panel
│   └── api/dashboard-analytics/  ← este paquete vive aquí
└── ...
```

## Decisiones arquitecturales clave (recap)

1. **Next.js separado, no embebido en Fastify.** Justificación: el SPA admin ya está en `apps/api/public/` con su propio propósito. Embeber el panel allí complica el bundle, los roles, y rompe el modelo de "una app, un dominio, un propósito".

2. **Drizzle directo, sin API REST intermedia.** Justificación: cada métrica del panel se traduce a 1-2 queries SQL. Crear endpoints REST que envuelvan eso es trabajo doble. Server Components leen en server-side con cero latencia adicional.

3. **Auth propia mínima.** Justificación: el SPA admin tiene `ADMIN_PASSWORD` + `ADMIN_JWT_SECRET`. El panel tiene `PANEL_PASSWORD` + `PANEL_JWT_SECRET`. Variables distintas, secret distinto, sesiones independientes. "Después se unifica si hace falta" (decisión del usuario).

4. **Sin migraciones nuevas.** Justificación: ver doc 04. El schema actual ya contiene todo.

5. **Tema único Sprint 1 (= idéntico al SPA admin).** Justificación: continuidad visual; eliminar fricción psicológica con Alex el día 1.

## Riesgos técnicos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El `packages/db` cambia de driver o de tipos rompiendo el panel | El panel reexporta del package sin reescribir tipos. Si rompe, falla en build, no en runtime. Pinear versión exacta del workspace. |
| Pool de DB del panel saturado | `max: 10` es conservador. Métricas básicas de Postgres deberían cubrir esto. Si pasa, abrir issue. |
| Cookies de auth panel se confunden con cookies del SPA admin | Nombre de cookie único: `panel_session`. Path: `/`. Domain: solo `dashboard.revolicord.com`. |
| Cold start del Next en Docker tarda mucho | Build `standalone` output de Next + Dockerfile multi-stage. Ver doc 11. |
| Schema multi-tenant filtrado mal en una query (data leak) | Cada query del panel **debe** tener `WHERE tenant_id = ?`. Doc 05 muestra los queries con tenant explícito. Code review obliga este check. |
| Latencia de queries en vista anual (12 meses × 5 etapas × 4 ratios) | Las queries usan agregación SQL en un solo round-trip. Estimado: <100ms en Postgres local con datos reales. Si se va a 500ms+, considerar materialized views en sprint posterior (no en este paquete). |

## Fuera de scope arquitectural

- WebSocket / live updates (Sprint 1 polling con `revalidate`).
- Multi-region.
- Read replicas de Postgres.
- CDN / edge caching (Cloudflare delante de Traefik queda como upgrade futuro).
- Logs estructurados → Loki / Grafana (el panel loguea a stdout, suficiente).

Fin del documento 03.
