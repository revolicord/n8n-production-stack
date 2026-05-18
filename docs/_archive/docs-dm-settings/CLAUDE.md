# CLAUDE.md

Este archivo es leído automáticamente por Claude Code al abrir el repo. Contiene las reglas operativas para que cualquier sesión sea productiva y consistente.

## Lo primero que debes hacer en cada sesión

1. Lee `docs/00-README.md` para orientarte.
2. Pregunta al founder: **"¿En qué sprint estamos del roadmap?"** (`docs/10-roadmap-de-implementacion.md`).
3. Lee los docs marcados como obligatorios para ese sprint.
4. Antes de tocar código, propón un plan de archivos a crear/modificar y espera confirmación.

## El stack y por qué

- **Runtime**: Node 20 LTS
- **Lenguaje**: TypeScript estricto (`"strict": true, "noUncheckedIndexedAccess": true`)
- **Gestor**: pnpm con workspaces
- **HTTP**: Fastify v4
- **Cola**: BullMQ
- **DB**: PostgreSQL 16 vía drizzle-orm
- **Cache/cola**: Redis 7 vía ioredis
- **Validación**: Zod
- **Logs**: pino
- **Tests**: vitest + supertest
- **Lint/format**: Biome (más rápido que ESLint+Prettier)
- **Build**: tsup o esbuild

**No introducir** dependencias fuera de esta lista sin un ADR en `docs/11-glosario-y-decisiones.md`.

## Reglas duras

### 1. Frontera código/n8n
Antes de añadir cualquier lógica, lee `docs/02-frontera-codigo-vs-n8n.md`. Si la lógica es de negocio del agente (prompts, tools, routing por intención), **va a n8n**, no a TypeScript. No hardcodear modelos LLM ni prompts en código.

### 2. Multi-tenancy desde el día 1
Toda tabla nueva: columna `tenant_id UUID NOT NULL` + RLS. Toda clave Redis nueva: prefijo con `{tenant_id}`. Toda query en código: filtro por tenant.

### 3. Logs estructurados desde el primer commit
Pino JSON con `correlation_id`. Nunca `console.log`. Nunca loggear el body completo de un webhook (puede tener PII).

### 4. Idempotencia en cada paso
- Webhooks: hash → Redis SET NX.
- Jobs BullMQ: `jobId` determinista cuando aplique.
- Endpoints admin: `POST` con `Idempotency-Key` opcional para retries seguros.

### 5. Variables de entorno
- Todas en `.env.example` (committed) con placeholders.
- Validadas con Zod al arranque (`apps/api/src/config.ts`). Si falta una, el proceso no arranca.
- Nunca leer `process.env.X` en mitad del código; siempre desde el `config` validado.

### 6. Tests
- Cada función no trivial tiene test unitario.
- Cada endpoint tiene test integración.
- El script Lua de debounce tiene test contra un Redis real (testcontainers).
- CI bloquea merge si tests no pasan.

### 7. Migraciones
- Drizzle-kit. Cada migración con `up` y `down`.
- Nunca editar una migración ya aplicada en producción; crear una nueva.
- Las migraciones se aplican en deploy con `pnpm db:migrate`, no automáticamente al iniciar la app.

### 8. Errores
- Errores de dominio: clases extendiendo `AppError` con `code`, `httpStatus`, `details`.
- Errores no esperados: capturados por handler global → Sentry.
- Nunca exponer stack traces en respuestas.

## Estructura del repo

```
.
├── apps/
│   └── api/
│       ├── src/
│       │   ├── server.ts          # Fastify HTTP entry
│       │   ├── worker.ts          # BullMQ worker entry
│       │   ├── config.ts          # env validation
│       │   ├── routes/
│       │   │   ├── webhook-manychat.ts
│       │   │   ├── admin/
│       │   │   │   ├── turn-completed.ts
│       │   │   │   ├── tenants.ts
│       │   │   │   ├── subscribers.ts
│       │   │   │   ├── turns.ts
│       │   │   │   └── dlq.ts
│       │   │   └── health.ts
│       │   ├── services/
│       │   │   ├── debounce.ts    # Lua + buffer ops
│       │   │   ├── ratelimit.ts
│       │   │   ├── dispatch-n8n.ts
│       │   │   └── manychat-api.ts (si fuera necesario)
│       │   ├── workers/
│       │   │   └── process-batch.ts
│       │   ├── lib/
│       │   │   ├── redis.ts
│       │   │   ├── db.ts
│       │   │   ├── logger.ts
│       │   │   ├── metrics.ts
│       │   │   └── auth.ts
│       │   ├── plugins/           # Fastify plugins
│       │   └── jobs/              # cron-like jobs
│       ├── test/
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   └── schemas/           # Zod schemas compartidos
│   │   └── package.json
│   └── db/
│       ├── src/
│       │   ├── schema.ts          # drizzle schema
│       │   └── migrations/
│       └── package.json
│
├── n8n/
│   └── workflows/                 # exports JSON versionados
│
├── infra/
│   ├── docker-compose.yml
│   ├── caddy/
│   ├── postgres/
│   ├── prometheus/
│   ├── grafana/
│   └── scripts/
│
├── docs/                          # los markdowns de este repo
├── .env.example
├── .gitignore
├── biome.json
├── tsconfig.base.json
├── pnpm-workspace.yaml
└── package.json
```

## Patrones obligatorios

### Definir un endpoint Fastify

```ts
// apps/api/src/routes/admin/example.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ParamsSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({ until: z.string().datetime() });

export default async function exampleRoute(fastify: FastifyInstance) {
  fastify.post('/admin/subscribers/:id/pause', {
    preHandler: [fastify.requireAdminAuth],
    schema: {
      params: ParamsSchema,
      body: BodySchema,
    },
    async handler(req, reply) {
      const { id } = req.params as z.infer<typeof ParamsSchema>;
      const { until } = req.body as z.infer<typeof BodySchema>;
      // ...
      return reply.code(204).send();
    },
  });
}
```

### Acceder a Redis siempre vía cliente compartido

```ts
import { redis } from '@/lib/redis';
// nunca new Redis() en mitad del código
```

### Acceder a Postgres siempre vía drizzle

```ts
import { db } from '@/lib/db';
import { subscribers } from '@db/schema';

const list = await db.select().from(subscribers).where(eq(subscribers.tenantId, tenantId));
// nunca queries SQL crudas a menos que sea Lua o algo que drizzle no soporte
```

### Definir un worker BullMQ

```ts
// apps/api/src/workers/process-batch.ts
import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';

export const processBatchWorker = new Worker(
  'process-batch',
  async (job) => { /* ... */ },
  { connection: redis.duplicate(), concurrency: 10 },
);

processBatchWorker.on('failed', (job, err) => { /* ... */ });
```

## Lo que NO debes hacer

- ❌ Crear archivos sin que el founder los pida.
- ❌ Reorganizar el repo "porque es más limpio".
- ❌ Cambiar de Fastify a Express, o de drizzle a Prisma, sin ADR.
- ❌ Inventarte campos en tablas o claves Redis no documentadas.
- ❌ Hacer "while I'm here" refactors junto a una feature.
- ❌ Commitear sin pasar typecheck + lint + tests localmente.
- ❌ Saltarte la validación Zod "porque es solo para mí".
- ❌ Usar `any`. Si no sabes el tipo, pregunta.
- ❌ Hacer requests directas a la API de Meta. Esa es responsabilidad de ManyChat (vía API de ManyChat) o de n8n.

## Cuando dudes

- Lee los docs.
- Si los docs no responden, pregunta al founder.
- Si la respuesta requiere una decisión arquitectónica, escribe ADR antes de implementar.

## Comandos comunes

```bash
# Desarrollo local
pnpm install
pnpm db:migrate
pnpm dev:api          # arranca Fastify con tsx watch
pnpm dev:worker       # arranca worker con tsx watch

# Tests
pnpm test
pnpm test:integration

# Build
pnpm build
pnpm typecheck
pnpm lint

# DB
pnpm db:generate      # genera migración desde schema.ts
pnpm db:migrate       # aplica
pnpm db:studio        # drizzle studio

# Docker
docker compose up -d
docker compose logs -f api
docker compose exec api node dist/scripts/<algo>.js
```

## Convenciones de commits

Conventional Commits:
- `feat(api): add subscriber pause endpoint`
- `fix(worker): release lock on n8n timeout`
- `refactor(debounce): extract token validation`
- `docs(adr): add ADR-0009 for prompt versioning`
- `test(debounce): add concurrent message scenario`
- `chore(deps): bump fastify to 4.28`

PRs (cuando los haya): título = primer commit, descripción = qué + por qué + cómo testeé.

---

Cuando termines una tarea: actualiza `docs/10-roadmap-de-implementacion.md` marcando lo hecho y resume al founder qué falta para cerrar el sprint.
