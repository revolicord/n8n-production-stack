# PLAN — Quantum Setting Dashboard

> **Para:** Claude Sonnet ejecutando el trabajo en `revolicord/n8n-production-stack`.
> **Objetivo:** que Alex pueda, desde un panel web, editar el texto de los follow-ups, subir/reemplazar la imagen del meme, y ajustar el tiempo entre follow-ups, **sin tocar n8n, sin tocar la BD, sin tocar el repo**.
> **Diseño visual de referencia:** el dashboard tipo dark con menú lateral de fases y secciones acordeón por slot (1B, 2B, 3B…) que el usuario ya validó. Replicar esa UX.
> **No es un plan especulativo.** Cada paso indica los ficheros que toca y deja tests/checks claros. Si algo se desvía, abrir issue y parar — no improvisar.

---

## 0. Estado actual — qué ya está y qué no

**Ya hecho (no tocar a menos que el plan lo pida explícitamente):**
- Schema BD completo: `funnel_stages`, `followup_templates`, `followup_messages`, `lead_followup_log`, `lead_crons` (ADR-0015 + ADR-0018, migraciones 0002–0008).
- Endpoints CRUD Fastify en `apps/api/src/routes/admin/`:
  - `followups.ts` — GET/POST/PUT/DELETE de `followup_templates` por etapa.
  - `followup-messages.ts` — GET/POST/PUT/DELETE de `followup_messages` por template.
  - `assets.ts` — `POST /admin/assets/upload` sube a MinIO bucket `assets` y devuelve URL pública.
- Multipart registrado en `server.ts` (8 MB).
- Auth Bearer estática (`N8N_CALLBACK_TOKEN`) en todos los `/admin/*`.
- Workflow `followup-runner` especificado en `n8n/workflows/followup-runner/*.md` (no creado en n8n UI todavía — fuera de este plan).

**Lo que falta y este plan construye:**
1. Migración `delay_hours` → `delay_minutes` (toca BD, API, n8n SQL).
2. Endpoint `GET /admin/funnel-stages` para poblar el menú lateral del dashboard.
3. Login real con JWT + tabla mental de "admin tokens" (no hay sistema de usuarios, basta una contraseña y un secret).
4. CORS configurado para que el dashboard servido desde el mismo dominio o subpath funcione.
5. Fix de la invariante de `followup-messages` en PUT (bug conocido).
6. Tabla nueva `agent_resources` para "Cierres" y "Objeciones" (recursos del agente, NO follow-ups).
7. Endpoints CRUD para `agent_resources`.
8. **Frontend SPA** servido por el mismo Fastify desde `/dashboard` — sin build complejo, HTML + JS vanilla + tailwind por CDN (replica visual del screenshot de Alex).
9. Setup automático del bucket público de MinIO.
10. Documentación + ADR.

---

## 1. Convenciones que el ejecutor debe respetar

- **Idioma:** todos los logs, mensajes de error de usuario, comentarios de código nuevos y ADRs en español neutro. El código (nombres de variables/funciones) en inglés. Igual que el resto del repo.
- **snake_case en body de request, camelCase en filas Drizzle de respuesta** — patrón ya establecido.
- **Tests:** todo schema Zod nuevo lleva tests en `*.test.ts` al lado del fichero. Mínimo 1 happy path + 1 rejection. Ejecutar `pnpm test` antes de cerrar cada paso.
- **Typecheck:** `pnpm typecheck` debe pasar antes de cerrar cada paso. Si falla, parar y arreglar antes de seguir.
- **Lint:** `pnpm lint` antes de commitear.
- **Commits:** uno por paso del plan, mensaje en imperativo, prefijo `feat:` / `fix:` / `chore:` / `docs:` según corresponda.
- **No tocar el `N8N_ENCRYPTION_KEY`** ni nada cifrado.
- **No borrar tablas** — todo es ADD COLUMN / soft delete.
- **Migraciones Drizzle:** generar con `pnpm db:generate` desde `packages/db/`. Revisar el SQL generado antes de commitearlo. Numerar correlativamente (siguiente: `0009`).
- **n8n:** los JSON de workflows (`agent-run(N).json`) son auto-generados y **no se editan a mano**. Sí se editan los `.md` de especificación. Las queries SQL que estos `.md` contienen se actualizan también, y se le avisa al usuario al final para que aplique los cambios en la UI de n8n.

---

## 2. Paso 1 — Migración `delay_hours` → `delay_minutes`

### Motivación
Hoy `followup_templates.delay_hours` es un entero de horas. La fase C tiene un slot 1C que se envía a **15 minutos** y otros que se envían a **2 horas**. No se puede representar 15 min con `delay_hours: 1` (queda en 1 hora). Renombrar a `delay_minutes` permite todos los casos sin floats.

### Cambios

**2.1 Migración SQL (`packages/db/drizzle/0009_delay_minutes.sql`)**

```sql
-- Renombrar columna y convertir valores existentes (hours * 60 = minutes).
ALTER TABLE api.followup_templates
  RENAME COLUMN delay_hours TO delay_minutes;

UPDATE api.followup_templates
  SET delay_minutes = delay_minutes * 60;
```

> Drizzle a veces no genera RENAME limpio. Si `pnpm db:generate` produce DROP + ADD, **borrar ese SQL generado y escribir manualmente** el RENAME + UPDATE como arriba para no perder datos en producción. Comentar en el fichero por qué se hizo a mano.

**2.2 Schema Drizzle (`packages/db/src/schema.ts`)**

- En `followupTemplates`: renombrar `delayHours: integer('delay_hours')` → `delayMinutes: integer('delay_minutes')`.
- Regenerar tipos (no requiere comando — Drizzle infiere).

**2.3 API service (`apps/api/src/services/followups.ts`)**

- `createFollowupTemplate` arg `delayHours` → `delayMinutes`.
- `updateFollowupTemplate` patch `delayHours` → `delayMinutes`.

**2.4 API route (`apps/api/src/routes/admin/followups.ts`)**

- Zod schemas: `delay_hours` → `delay_minutes`.
- Mapeos: `drizzlePatch.delayHours = patch.delay_hours` → `drizzlePatch.delayMinutes = patch.delay_minutes`.
- Mensajes de error mantenidos.

**2.5 Tests (`apps/api/src/routes/admin/followups.test.ts`)**

- Reemplazar todas las apariciones de `delay_hours` en los test cases por `delay_minutes`.
- Añadir test extra: `accepts delay_minutes: 15` y `accepts delay_minutes: 1440` (1 día).

**2.6 n8n — actualizar las queries en los `.md`**

Tres ficheros tocan `delay_hours`:

a) `n8n/nodes/99-upsert-lead-cron.md` línea 22:
```sql
-- Antes:
NOW() + ft.delay_hours * INTERVAL '1 hour',
-- Después:
NOW() + ft.delay_minutes * INTERVAL '1 minute',
```

b) `n8n/workflows/followup-runner.md` línea 50 y `n8n/workflows/followup-runner/02-get-due-leads.md` línea 29:
```sql
-- Antes:
ft_next.delay_hours                AS next_delay_hours
-- Después:
ft_next.delay_minutes              AS next_delay_minutes
```

Actualizar también los nombres en la tabla de "Campos de salida" del mismo `.md`.

c) `n8n/workflows/followup-runner/09-build-sql.md` líneas 18 y 45:
```js
// Antes:
const delayHours = pd.next_delay_hours;
// ...
"next_followup_at = NOW() + INTERVAL '" + parseInt(delayHours) + " hours', "
// Después:
const delayMinutes = pd.next_delay_minutes;
// ...
"next_followup_at = NOW() + INTERVAL '" + parseInt(delayMinutes) + " minutes', "
```

**2.7 Seed (`packages/db/drizzle/seed_qc_funnel.sql`)**

Buscar todas las apariciones de `delay_hours` en este fichero y convertir a `delay_minutes` (multiplicar el valor por 60 si era horas). El seed no se ha aplicado en producción todavía (ver `SETTER-MVP-TRACKING.md`), así que cambiarlo aquí es seguro.

**2.8 Docs API (`docs/api/followup-templates.md`)**

Reemplazar `delay_hours` por `delay_minutes` en todos los ejemplos y la tabla de campos. Actualizar el ejemplo `"delayHours": 24` por `"delayMinutes": 1440`.

### Checks
- [ ] `pnpm typecheck` pasa.
- [ ] `pnpm test` pasa.
- [ ] El SQL de la migración 0009 hace RENAME + UPDATE en una sola transacción (Drizzle envuelve automáticamente cada fichero `.sql` en BEGIN/COMMIT).
- [ ] Commit: `feat(db): rename delay_hours to delay_minutes for granular cadence`.

---

## 3. Paso 2 — Endpoint `GET /admin/funnel-stages`

### Motivación
El dashboard necesita poblar el menú lateral ("General", "Fase B", "Fase C"...). Hoy `funnel_stages` solo se lee desde n8n por SQL directo — no hay HTTP endpoint.

### Cambios

**3.1 Service (`apps/api/src/services/followups.ts`)**

Añadir al final del fichero:

```ts
export async function listFunnelStages(
  db: DbClient,
  args: { tenantId: string; includeInactive?: boolean },
): Promise<FunnelStage[]> {
  const condition = args.includeInactive
    ? eq(funnelStages.tenantId, args.tenantId)
    : and(eq(funnelStages.tenantId, args.tenantId), eq(funnelStages.isActive, true));

  return db
    .select()
    .from(funnelStages)
    .where(condition)
    .orderBy(asc(funnelStages.position));
}
```

Importar `FunnelStage` del schema y reexportarlo si hace falta.

**3.2 Route (`apps/api/src/routes/admin/followups.ts`)**

Añadir endpoint al inicio (antes del GET de followups por etapa):

```ts
// GET /admin/tenants/:tenantId/funnel-stages
app.get<{ Params: { tenantId: string }; Querystring: { include_inactive?: string } }>(
  '/admin/tenants/:tenantId/funnel-stages',
  async (req, reply) => {
    if (!auth(req.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const tenantParsed = UuidParamSchema.safeParse(req.params.tenantId);
    if (!tenantParsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_PAYLOAD', details: tenantParsed.error.issues } });
    }
    const includeInactive = req.query.include_inactive === 'true';
    const stages = await listFunnelStages(getDb(), { tenantId: tenantParsed.data, includeInactive });
    return reply.code(200).send({ stages });
  },
);
```

**3.3 Doc (`docs/api/followup-templates.md`)**

Añadir sección "List Funnel Stages" antes de "List Followups" siguiendo el mismo formato.

### Checks
- [ ] `curl` manual:
  ```
  curl -s http://localhost:3000/admin/tenants/$TENANT_ID/funnel-stages \
    -H "Authorization: Bearer $N8N_CALLBACK_TOKEN" | jq
  ```
  devuelve `{ "stages": [...] }`.
- [ ] Commit: `feat(api): list funnel stages by tenant for admin dashboard`.

---

## 4. Paso 3 — Tabla `agent_resources` + endpoints (Cierres / Objeciones)

### Motivación
Las pestañas "Cierres" y "Objeciones" del panel **no son follow-ups**. Son **recursos** (snippets de texto + opcionalmente imagen) que el agente IA debe poder consultar y enviar cuando detecta un contexto que aplica (lead pide precio, lead duda de la promesa, etc.). El agente usa una tool `get_agent_resources(category)` para listarlos en el prompt y otra `send_resource(slug)` para enviarlos (esta segunda es para el sprint que viene, **no entra en este plan** — aquí solo CRUD + listado).

### Cambios

**4.1 Migración (`packages/db/drizzle/0010_agent_resources.sql`)**

```sql
CREATE TABLE api.agent_resources (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES api.tenants(id) ON DELETE CASCADE,
  category      TEXT         NOT NULL CHECK (category IN ('cierre', 'objecion', 'general')),
  slug          TEXT         NOT NULL,
  display_name  TEXT         NOT NULL,
  trigger_hint  TEXT,                              -- "cuándo usar" para el prompt del agente
  text_content  TEXT,                              -- texto a enviar (soporta {{name}})
  media_url     TEXT,                              -- URL MinIO opcional
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX agent_resources_tenant_slug_unique
  ON api.agent_resources (tenant_id, slug);

CREATE INDEX agent_resources_tenant_category_idx
  ON api.agent_resources (tenant_id, category, is_active);
```

**4.2 Schema Drizzle (`packages/db/src/schema.ts`)**

Añadir tabla `agentResources` al final, antes de los `export type`, copiando el patrón de `followupMessages`. Añadir los tipos inferidos al final del fichero.

**4.3 Service (`apps/api/src/services/agent-resources.ts` — nuevo)**

CRUD básico: `listAgentResources(db, { tenantId, category? })`, `getAgentResourceById(db, id)`, `createAgentResource(db, ...)`, `updateAgentResource(db, id, patch)`, `deactivateAgentResource(db, id)`. Mismo patrón que `services/followups.ts`.

**4.4 Route (`apps/api/src/routes/admin/agent-resources.ts` — nuevo)**

Endpoints (mismo patrón que `admin/followups.ts`, auth Bearer):

- `GET    /admin/tenants/:tenantId/agent-resources?category=cierre`
- `POST   /admin/tenants/:tenantId/agent-resources`
- `PUT    /admin/agent-resources/:id`
- `DELETE /admin/agent-resources/:id` (soft delete)

Zod schemas:

```ts
const CategoryEnum = z.enum(['cierre', 'objecion', 'general']);

const CreateAgentResourceBodySchema = z.object({
  category: CategoryEnum,
  slug: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
  display_name: z.string().min(1).max(200),
  trigger_hint: z.string().max(500).optional(),
  text_content: z.string().optional(),
  media_url: z.string().url().optional(),
  sort_order: z.number().int().min(0).optional(),
});
```

Validación de negocio: al menos uno de `text_content` o `media_url` debe ser no nulo. Tests al lado.

**4.5 Registrar en `apps/api/src/routes/index.ts`**

```ts
import agentResourcesRoutes from './admin/agent-resources.js';
// ...
await app.register(agentResourcesRoutes);
```

**4.6 Doc (`docs/api/agent-resources.md` — nuevo)**

Misma plantilla que `followup-templates.md` con el modelo de datos, endpoints, ejemplos, errores. Linkear desde `docs/api/README.md`.

**4.7 ADR (`docs/adr/0019-agent-resources.md` — nuevo)**

Y-statement breve: por qué tabla nueva en lugar de reusar `followup_templates` o `stage_flows`. Decisión: porque los recursos NO son secuenciados (no tienen `sequence_number`), NO están atados a una etapa, y el agente los consulta on-demand. Mezclarlo con followups complica el runner.

### Checks
- [ ] `pnpm db:generate` produce el `0010_*.sql` esperado (o se edita a mano si hace falta) y la migración pasa contra una BD limpia.
- [ ] `pnpm test` pasa.
- [ ] `pnpm typecheck` pasa.
- [ ] Commit: `feat(api): add agent_resources table and CRUD for closures/objections`.

> **Nota para el ejecutor:** la integración con el agente IA (tool `get_agent_resources`) está fuera de este plan. Solo se construye el plano de control para que Alex edite los recursos. Mencionarlo en el ADR como "siguiente paso".

---

## 5. Paso 4 — Auth JWT real

### Motivación
Hoy `/admin/*` se autentica con el mismo Bearer estático que usa n8n para llamarse a sí mismo. Para el dashboard, Alex no va a pegar ese token cada sesión. Hay que añadir login con contraseña + JWT corto.

`ADMIN_JWT_SECRET` y `ADMIN_PASSWORD` ya existen en `config.ts` pero no se usan en ninguna parte.

### Cambios

**5.1 Instalar dependencia**

```bash
cd apps/api && pnpm add @fastify/jwt
```

**5.2 Registrar plugin (`apps/api/src/server.ts`)**

Después del `multipart`:

```ts
import jwt from '@fastify/jwt';
// ...
await app.register(jwt, {
  secret: config.ADMIN_JWT_SECRET,
  sign: { expiresIn: '12h' },
});
```

**5.3 Endpoint login (`apps/api/src/routes/admin/login.ts` — nuevo)**

```ts
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getConfig } from '../../config.js';

const LoginBodySchema = z.object({
  password: z.string().min(1),
});

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export default async function loginRoute(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.post('/admin/login', async (req, reply) => {
    const parsed = LoginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_PAYLOAD' } });
    }
    if (!safeEqualString(parsed.data.password, config.ADMIN_PASSWORD)) {
      // Pequeño delay artificial para no filtrar timing con sólo length-check
      await new Promise((r) => setTimeout(r, 250));
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
    }
    const token = app.jwt.sign({ role: 'admin' });
    return reply.code(200).send({ token, expires_in: 12 * 3600 });
  });
}
```

Registrarlo en `apps/api/src/routes/index.ts`.

**5.4 Middleware dual-auth (`apps/api/src/lib/auth.ts`)**

Hoy `verifyBearerToken` solo compara contra `N8N_CALLBACK_TOKEN`. Necesitamos que `/admin/*` también acepte JWTs de Alex. Pero `/admin/turn-completed` y `/admin/leads/:id/stage` los llama n8n con el bearer estático.

**Decisión:** mantener compatibilidad — los endpoints aceptan **ambos**:
- Bearer `N8N_CALLBACK_TOKEN` → válido siempre (lo usan n8n y scripts internos).
- JWT firmado con `ADMIN_JWT_SECRET` y `role: admin` → válido en `/admin/*`.

Crear un helper nuevo `verifyAdminAuth(req, app)` que devuelva `true` si alguno de los dos pasa:

```ts
// apps/api/src/lib/admin-auth.ts (nuevo)
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyBearerToken } from './auth.js';
import { getConfig } from '../config.js';

export async function verifyAdminAuth(
  req: FastifyRequest,
  app: FastifyInstance,
): Promise<boolean> {
  const cfg = getConfig();
  // Camino 1: bearer estático (n8n, scripts)
  if (verifyBearerToken(req.headers.authorization, cfg.N8N_CALLBACK_TOKEN)) {
    return true;
  }
  // Camino 2: JWT de admin
  try {
    const decoded = await req.jwtVerify<{ role?: string }>();
    return decoded.role === 'admin';
  } catch {
    return false;
  }
}
```

**5.5 Reemplazar `auth()` en los routes de admin**

En `admin/followups.ts`, `admin/followup-messages.ts`, `admin/assets.ts`, `admin/agent-resources.ts`, `admin/set-stage.ts`, `admin/turn-completed.ts`:

- Importar `verifyAdminAuth` de `lib/admin-auth.js`.
- Cambiar la función local `auth(authorization)` por `await verifyAdminAuth(req, app)` (el handler debe ser async — ya lo es).
- Mantener el comportamiento: si falla → 401.

> **No tocar** `webhook-manychat.ts` ni `tools.ts` — esos no son `/admin/*` y mantienen su auth dedicada.

**5.6 Tests (`apps/api/src/routes/admin/login.test.ts` — nuevo)**

Mínimo dos tests sobre `LoginBodySchema`: acepta `{ password: "x" }`, rechaza `{}`. Tests de integración del flujo completo (login → llamar a /admin/funnel-stages con JWT) están fuera de scope (no hay infra de tests de integración hoy).

**5.7 Docs (`docs/api/README.md`)**

- Sección nueva "Autenticación" sustituyendo la actual, explicando los dos caminos.
- Añadir el endpoint `POST /admin/login` a la tabla.

### Checks
- [ ] `curl -X POST .../admin/login -d '{"password":"..."}'` devuelve `{ token, expires_in }`.
- [ ] Con token mal: 401.
- [ ] Con `Authorization: Bearer <jwt>` se pueden llamar los endpoints admin.
- [ ] Con `Authorization: Bearer <N8N_CALLBACK_TOKEN>` siguen funcionando.
- [ ] `pnpm typecheck && pnpm test && pnpm lint` pasan.
- [ ] Commit: `feat(api): JWT login for admin dashboard with backwards-compatible bearer`.

---

## 6. Paso 5 — CORS y fix de invariante en followup-messages

### 6.1 CORS

El dashboard se sirve desde el mismo Fastify (decisión de Alex), entonces **en runtime mismo dominio**. Pero en desarrollo local Alex va a tener el dashboard en `localhost:8787` (donde lo prototipa) y la API en `localhost:3000`. **Configurar CORS abierto en `development`, estricto en `production`.**

Instalar:
```bash
cd apps/api && pnpm add @fastify/cors
```

En `server.ts`, después de helmet:

```ts
import cors from '@fastify/cors';
// ...
await app.register(cors, {
  origin: config.NODE_ENV === 'production' ? false : true, // production: same-origin only
  credentials: true,
});
```

`origin: false` significa "no responde con CORS headers" → mismo-origen funciona (el dashboard se sirve desde el mismo Fastify), navegadores rechazan cross-origin. `origin: true` en development refleja el `Origin` recibido → cualquier puerto local funciona.

### 6.2 Fix bug en PUT de followup-messages

`apps/api/src/routes/admin/followup-messages.ts` permite hacer `PUT` con `text_content: null` aunque `message_type` siga siendo `'text'`. Esto es inconsistente.

Aplicar el mismo patrón merge+revalidar que existe en `followups.ts` para el invariante `type/field`:

```ts
function isMessageConsistent(
  messageType: string,
  textContent: string | null,
  mediaUrl: string | null,
): boolean {
  if (messageType === 'text') return !!textContent;
  if (messageType === 'image') return !!mediaUrl;
  return false;
}

// En el handler PUT, antes de aplicar el patch:
const existing = await getFollowupMessageById(db, id);
if (!existing) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

const effectiveType = body.message_type ?? existing.messageType;
const effectiveText =
  'text_content' in body ? body.text_content : existing.textContent;
const effectiveMedia =
  'media_url' in body ? body.media_url : existing.mediaUrl;

if (!isMessageConsistent(effectiveType, effectiveText, effectiveMedia)) {
  return reply.code(400).send({
    error: {
      code: 'INVALID_PAYLOAD',
      message: 'text_content requerido si message_type=text; media_url requerido si message_type=image',
    },
  });
}
```

Añadir tests al lado.

### Checks
- [ ] CORS: desde `http://localhost:8787` se puede hacer fetch a `http://localhost:3000/admin/...` con `credentials: 'include'` o `Authorization` header.
- [ ] PUT con `{ text_content: null }` sobre un mensaje `message_type=text` devuelve 400.
- [ ] Commit: `fix(api): enforce text/image invariant on followup-messages PUT; add CORS`.

---

## 7. Paso 6 — Auto-crear y configurar el bucket público de MinIO

### Motivación
ADR-0018 dice que el bucket `assets` debe existir y tener política `download anonymous`. Hoy hay que crearlo a mano en la consola de MinIO. El `setup.sh` no lo hace.

### Cambios

**7.1 Script nuevo `scripts/init-minio-bucket.sh`**

```bash
#!/usr/bin/env bash
# Crea (si no existe) el bucket `assets` en MinIO y le aplica política de lectura pública.
# Idempotente — se puede correr varias veces.
#
# Uso:
#   bash scripts/init-minio-bucket.sh
#
# Requiere las vars del .env cargadas (MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
# MINIO_BUCKET_ASSETS).

set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${MINIO_ENDPOINT:?MINIO_ENDPOINT no definido}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY no definido}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY no definido}"
: "${MINIO_BUCKET_ASSETS:=assets}"

# Usar el cliente mc en docker (no instalar nada local)
docker run --rm --network host \
  -e MC_HOST_local="${MINIO_ENDPOINT//https:\/\//https://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@}" \
  minio/mc:latest sh -c "
    mc mb --ignore-existing local/${MINIO_BUCKET_ASSETS} && \
    mc anonymous set download local/${MINIO_BUCKET_ASSETS}
  "

echo "✅ Bucket '${MINIO_BUCKET_ASSETS}' listo (existe + lectura pública)."
```

**7.2 Integrarlo en `scripts/setup.sh`**

Al final del script, después del despliegue del stack y antes del banner final, añadir:

```bash
info "Configurando bucket público de MinIO para assets..."
bash "$(dirname "$0")/init-minio-bucket.sh" || warn "init-minio-bucket falló — corrígelo a mano después"
```

**7.3 Documentar en `README.md`**

Sección "MinIO bucket público" debajo de "Instalación desde cero":

> El bucket `assets` se crea automáticamente con política de lectura pública. Si se necesita recrear o hay un error, correr `bash scripts/init-minio-bucket.sh` después del deploy.

### Checks
- [ ] Ejecutar el script dos veces seguidas no rompe nada (idempotente).
- [ ] Subir un asset por la API y abrirlo en navegador devuelve la imagen sin auth.
- [ ] Commit: `chore(infra): auto-create public MinIO bucket on setup`.

---

## 8. Paso 7 — Frontend SPA servida por Fastify

### Motivación
Dashboard tipo el screenshot, servido desde el mismo Fastify (decisión de Alex), accesible en `https://api.tudominio.com/dashboard`. Sin build complejo: HTML + JS vanilla + Tailwind por CDN. Se mantiene en un solo fichero por simplicidad, modularizado con `<script type="module">`. Replicar la UX del screenshot: dark, menú lateral con fases, panel derecho con secciones por slot (texto + asset path + preview).

### Estructura

```
apps/api/public/
  index.html        ← dashboard SPA completo (vanilla JS + Tailwind CDN)
  app.js            ← lógica (fetch, render, eventos)
  styles.css        ← overrides puntuales sobre Tailwind
  favicon.svg
```

> **Por qué `apps/api/public/`:** el plugin `@fastify/static` lo sirve como assets en una sola línea. No requiere build. El `Dockerfile` ya copia `src/`; añadirle un `COPY public ./public` es trivial.

### Cambios

**8.1 Instalar dependencia**

```bash
cd apps/api && pnpm add @fastify/static
```

**8.2 Registrar en `server.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import staticPlugin from '@fastify/static';
// ...
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await app.register(staticPlugin, {
  root: resolve(__dirname, '..', 'public'),
  prefix: '/dashboard/',
  decorateReply: false,
});

// Redirigir /dashboard (sin slash) a /dashboard/
app.get('/dashboard', (_req, reply) => reply.redirect('/dashboard/'));
```

**8.3 Dockerfile (`apps/api/Dockerfile`)**

Asegurar que `public/` se copia. Revisar el Dockerfile actual y añadir un `COPY apps/api/public ./apps/api/public` en la etapa que corresponda.

**8.4 SPA — `apps/api/public/index.html`**

Estructura visual (replicar el screenshot de Alex):

- Cabecera: título "Quantum Setting Dashboard", subtítulo "Edita mensajes, cadencias y assets que lee la skill global `haz-setting`."
- Botón fijo arriba a la derecha "Guardar cambios" (verde teal). Hace `PUT` a cada template/mensaje que tenga `dirty=true`.
- Menú lateral izquierdo (~280px): lista de fases (botones con `display_name` de `funnel_stages`), más al final dos botones especiales: **Cierres** y **Objeciones** (categorías de `agent_resources`), y un último **JSON completo** (modo debug que muestra el JSON crudo).
- Panel derecho: para cada slot (sequence_number), una card con:
  - Header `{sequence_number}{stage_slug} · {type}` (ej. `1B · meme_plus_text`).
  - Para `type=text`: un textarea con `text_template` editable.
  - Para `type=content`: una sección por cada `followup_messages`:
    - `message_type=text`: textarea.
    - `message_type=image`: input "Asset path" (read-only mostrando `media_url`), input file "Subir/reemplazar" (POST a `/admin/assets/upload`), y debajo un thumbnail.
  - Input "Delay (minutos)" con el `delay_minutes`.
  - Botón pequeño "Eliminar slot" (DELETE soft).

Paleta y tipografía: dark, fondo `#0d0d0d`, paneles `#1a1a1a`, acento teal `#14b8a6` (Tailwind `teal-500`), monospace para títulos. Match con el screenshot.

**8.5 `app.js` — lógica**

Vanilla JS con `fetch`. Pseudoestructura:

```js
const STATE = {
  token: localStorage.getItem('admin_token'),
  tenantId: null,                    // se setea en login (ver más abajo)
  stages: [],
  currentStageId: null,
  currentTab: 'phases',              // 'phases' | 'cierre' | 'objecion' | 'general' | 'json'
  templates: [],                     // templates de la etapa actual con messages embebidos
  resources: [],                     // recursos de agent_resources
  dirty: new Set(),                  // ids modificados pending save
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${STATE.token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function login(password) {
  const r = await fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error('bad password');
  const { token } = await r.json();
  STATE.token = token;
  localStorage.setItem('admin_token', token);
}

async function loadStages() {
  const { stages } = await api(`/admin/tenants/${STATE.tenantId}/funnel-stages`);
  STATE.stages = stages;
  renderSidebar();
}

async function loadTemplatesForStage(stageId) {
  const { followups } = await api(`/admin/funnel-stages/${stageId}/followups`);
  // Para cada template con type='content', traer sus messages en paralelo
  const withMessages = await Promise.all(followups.map(async (t) => {
    if (t.type !== 'content') return t;
    const messages = await api(`/admin/followup-templates/${t.id}/messages`);
    return { ...t, messages };
  }));
  STATE.templates = withMessages;
  renderMainPanel();
}

async function saveAll() {
  for (const id of STATE.dirty) {
    const entity = findEntityById(id); // template o message
    const path = entity._kind === 'template'
      ? `/admin/followup-templates/${id}`
      : `/admin/followup-messages/${id}`;
    await api(path, { method: 'PUT', body: JSON.stringify(entity._patch) });
  }
  STATE.dirty.clear();
  toast('Cambios guardados');
}

async function uploadAsset(file, messageId) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/admin/assets/upload?tenant_id=${STATE.tenantId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${STATE.token}` }, // sin Content-Type, lo pone el browser
    body: fd,
  });
  if (!res.ok) throw new Error('upload failed');
  const { url } = await res.json();
  // Actualizar el message con el nuevo media_url
  await api(`/admin/followup-messages/${messageId}`, {
    method: 'PUT',
    body: JSON.stringify({ media_url: url }),
  });
  await loadTemplatesForStage(STATE.currentStageId);
}
```

**Resolución de `tenantId`:** dado que hoy solo hay un tenant (Quantum Creators), el ejecutor:
1. Lee el `tenantId` del primer tenant activo en la BD con una query nueva o expone un endpoint `GET /admin/me` que devuelva `{ tenant_id }` (basado en el JWT — siempre el mismo en MVP).
2. **Opción más rápida y suficiente para MVP:** añadir un endpoint `GET /admin/tenants` que liste todos los tenants activos (uno solo en MVP), y el dashboard selecciona el primero al cargar. Esto deja la puerta abierta a multi-tenant sin más trabajo.

Implementarlo:

```ts
// apps/api/src/routes/admin/tenants.ts (nuevo)
app.get('/admin/tenants', async (req, reply) => {
  if (!(await verifyAdminAuth(req, app))) return reply.code(401).send({ error: { code: 'UNAUTHORIZED' } });
  const rows = await getDb().select({
    id: tenants.id, slug: tenants.slug, name: tenants.name
  }).from(tenants).where(eq(tenants.isActive, true));
  return reply.code(200).send({ tenants: rows });
});
```

Registrar en `routes/index.ts`.

**8.6 Login UI**

Al cargar `/dashboard/`, si no hay `STATE.token` válido, mostrar un overlay con un único input password y botón "Entrar". Tras login → fetch `/admin/tenants` → fetch funnel-stages → render.

**8.7 "JSON completo" (modo debug)**

Pestaña que muestra `JSON.stringify` del state actual (templates + messages + resources) con scroll y botón "Copiar al portapapeles". Es para que Alex/Claude debuggee sin abrir DevTools.

### Checks
- [ ] `GET /dashboard/` devuelve HTML 200.
- [ ] El login funciona; el token persiste en localStorage; al recargar entra directo.
- [ ] Editar el texto de un slot → "Guardar cambios" → recargar la página → el cambio persiste.
- [ ] Subir una imagen JPG nueva → el thumbnail aparece sin recargar y la URL es accesible públicamente.
- [ ] El menú lateral muestra todas las `funnel_stages` activas.
- [ ] El input de delay acepta "15" minutos y al guardar se persiste como 15.
- [ ] Commit: `feat(dashboard): vanilla SPA served from Fastify under /dashboard`.

---

## 9. Paso 8 — Tests, smoke e2e manual, documentación final

### 9.1 Test runner

```
pnpm typecheck
pnpm lint
pnpm test
```

Todo debe estar verde.

### 9.2 Smoke e2e manual (Claude debe documentar este checklist en `docs/api/dashboard-smoke.md`)

Con BD limpia + seed aplicado:

1. `pnpm dev:api`.
2. Abrir `http://localhost:3000/dashboard/`.
3. Login con `ADMIN_PASSWORD` del `.env`.
4. Click en "Fase B" del menú lateral → ver los slots.
5. Editar el texto del slot 1B → "Guardar cambios" → ver toast verde.
6. Reload del navegador → el texto persiste.
7. Click en slot 7B (meme) → subir una imagen JPG nueva → ver el thumbnail.
8. Abrir el `media_url` en pestaña incógnito → la imagen carga sin auth.
9. Cambiar delay a 15 minutos → guardar.
10. Click en "Cierres" → crear un recurso nuevo → guardar.
11. Logout → recargar → vuelve a pedir password.

### 9.3 Doc final

- Actualizar `README.md` con sección "Dashboard de configuración" explicando cómo acceder.
- Actualizar `docs/api/README.md` con los nuevos endpoints.
- ADR 0019 (agent_resources) ya escrito en paso 4.
- Cerrar el ADR-0018 sección "Consecuencias" añadiendo "El dashboard fue implementado en /dashboard del API Fastify (sin frontend separado)" como nota de seguimiento.

### 9.4 Commit final

`docs: dashboard smoke checklist and update top-level README`.

---

## 10. Cosas que el ejecutor debe AVISAR al usuario al terminar

Tras cerrar todos los pasos, dejar un comentario final con esta lista. Son cosas que Claude **no debe hacer** él mismo (requieren acción humana en producción / n8n):

1. **Aplicar migraciones 0009 y 0010 en producción:**
   ```
   cd /opt/n8n-production && DATABASE_URL=... pnpm db:migrate
   ```
2. **Editar el workflow `agent-run` en n8n UI** para reflejar el cambio `delay_hours` → `delay_minutes` en las dos queries SQL embebidas (ver paso 2.6). Los ficheros `agent-run(N).json` del repo son artefactos exportados — no editarlos a mano.
3. **Crear el workflow `followup-runner` en n8n UI** siguiendo los specs `.md`, ya con los SQL actualizados a `delay_minutes`. (Esto sigue siendo P0 según `SETTER-MVP-TRACKING.md`.)
4. **Setear `ADMIN_PASSWORD` y `ADMIN_JWT_SECRET` en producción** (.env) si no estaban ya.
5. **Verificar la política del bucket** con `mc anonymous get local/assets` — debe decir `download`.
6. **Decidir qué hacer con los assets ya subidos manualmente al MinIO** (los del screenshot tipo `setting_assets/phase_b/7B/...`): el dashboard espera URLs públicas absolutas. Si los assets están como rutas relativas en la BD, no van a renderizar. Hay un script de migración por hacer (no incluido aquí porque depende del estado real de los datos de Alex).

---

## 11. Deuda técnica detectada — NO entra en este plan, pero hay que registrarla

> El ejecutor abre un issue por cada uno en GitHub con el título exacto.

1. **`#tech-debt: ADRs 0010–0015 + migraciones 0002–0008 sin aplicar en producción.** `SETTER-MVP-TRACKING.md` ya lo marca P0. Sin esto no hay base donde correr el dashboard.

2. **`#tech-debt: `followup-runner` no creado en n8n UI.** Sigue siendo P0. Sin esto, podemos editar lo que queramos en el dashboard pero ningún seguimiento sale.

3. **`#tech-debt: 4 ficheros `agent-run(N).json` versionados pero auto-generados.** `agent-run.json` está a 0 bytes y los sufijados `(5)`–`(8)` ocupan ~200KB cada uno. Solo el más reciente es relevante. Decidir: o se borra el resto, o se documenta en `n8n/README.md` cuál es la "fuente de verdad".

4. **`#tech-debt: tests de integración inexistentes.** Solo hay tests unitarios de Zod schemas (`*.test.ts`). No hay tests que ejerciten Fastify + BD real. Configurar `vitest` + `testcontainers` (Postgres efímero) para los endpoints `/admin/*`. Especialmente el flujo de upload de assets a MinIO no se está cubriendo.

5. **`#tech-debt: el ADR-0018 dice que `followup_templates.type` pasa a `enum('text','flow','content')` pero no hay CHECK constraint en BD.** Solo se valida en Zod. Si alguien escribe directo a BD con un type inválido, los runners rompen. Añadir `ALTER TABLE … ADD CONSTRAINT followup_templates_type_check CHECK (type IN ('text','flow','content'))`.

6. **`#tech-debt: el ID del nodo "Get Due Leads" está hardcoded en el `.md`** (`e7cf67be-...`). Si Alex regenera el workflow, el ID cambia y los specs quedan desfasados. O eliminar los IDs de los `.md` o documentar que son ilustrativos.

7. **`#tech-debt: `lead_followup_log` no tiene constraint de unicidad por `(subscriber_id, sequence_number, conversation_id)`.** Lo nota el propio `09-build-sql.md` línea 76. Sin esto, si el runner reintenta tras un fallo parcial, se duplican entradas de log. Añadir constraint + `ON CONFLICT DO NOTHING` en el INSERT.

8. **`#tech-debt: helmet con `contentSecurityPolicy: false`.** Aceptable cuando era solo API JSON, pero ahora servimos HTML del dashboard. Reactivar CSP con una directiva mínima para el dashboard (`default-src 'self'; img-src 'self' <minio-domain> data:; style-src 'self' 'unsafe-inline' <tailwind-cdn>`). Si se hace ahora, evita un sprint de "endurecimiento" futuro.

9. **`#tech-debt: `ADMIN_HOST` en `.env.example` no se cablea en `docker-stack.yml`.** Es una variable que no hace nada hoy. O se usa (subdomain separado, contra-decisión de Alex), o se borra para no confundir.

10. **`#tech-debt: el seed `seed_qc_funnel.sql` requiere `<TENANT_ID>` reemplazado a mano.** Cualquier deploy nuevo es 100% manual en ese paso. Convertirlo en un script Node que reciba `--tenant-slug=quantum-creators` y haga el INSERT idempotente.

11. **`#tech-debt: el endpoint `POST /admin/assets/upload` recibe `tenant_id` como query string.** Hoy lo puede falsificar cualquiera con el bearer estático (escribirá en el path de otro tenant). Cuando haya multi-tenant real, extraerlo del JWT (`req.user.tenant_id`) y prohibir el override por query.

12. **`#tech-debt: documentación de la API se rompe en cada paso de este plan.** `docs/api/followup-templates.md` ya pasa a tener errores en cuanto se cambia `delay_hours` → `delay_minutes`. Mantenerlo sincronizado es trabajo manual. Considerar generar la doc desde los Zod schemas con `zod-to-openapi` en el sprint siguiente.

---

## 12. Orden de ejecución sugerido (estrictamente)

Cada paso es un commit. No saltarse el orden — cada uno desbloquea al siguiente.

1. Paso 2.1–2.8 — `delay_minutes` (BD + API + n8n specs).
2. Paso 3 — GET funnel-stages.
3. Paso 5 — fix invariante followup-messages.
4. Paso 6.1 — CORS.
5. Paso 4 — agent_resources (BD + endpoints + ADR).
6. Paso 5 (JWT login) — completo.
7. Paso 7 — bucket público MinIO.
8. Paso 8 — frontend SPA (es lo más largo; depende de todos los anteriores).
9. Paso 9 — tests + smoke + docs.
10. Mensaje final al usuario con la lista del **paso 10** y la deuda técnica del **paso 11**.

Fin del plan.
