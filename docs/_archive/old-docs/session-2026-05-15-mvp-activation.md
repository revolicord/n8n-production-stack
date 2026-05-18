# Sesión 2026-05-15 — Activación del MVP: migración, seed, agent-run + followup-runner

Documento de sesión. Registra todo lo ejecutado en producción para activar el MVP del setter de Instagram DM de Quantum Creators, y las instrucciones exactas para continuar.

> **Aviso de obsolescencia parcial (2026-05-16, v5):** las secciones que mencionan `tenants.config.system_prompt` reflejan la arquitectura de ese día. A partir de v5 el system_prompt vive en el Set node `System Prompt` del workflow `agent-run` (ver `n8n/nodes/00c-system-prompt.md`), no en DB. Las queries SQL `UPDATE tenants SET config = jsonb_set(...)` de este doc ya no aplican para el prompt; sí siguen aplicando para los otros campos de `tenants.config` (calendly_url, manychat_api_key, etc.).

---

## 1. Qué se hizo en esta sesión

### 1.1 Migración de base de datos aplicada

**Archivo:** `packages/db/drizzle/0002_polite_groot.sql`

Se aplicó directamente dentro del contenedor Postgres del Swarm (hostname `postgres`, sin puerto expuesto al host):

```bash
# Paso 1: aplicar SQL directamente
docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n \
  < packages/db/drizzle/0002_polite_groot.sql

# Paso 2: la columna current_stage_id no se creó (lead_stages ya existía)
# Se agregó manualmente:
docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n << 'EOF'
ALTER TABLE api.lead_stages ADD COLUMN IF NOT EXISTS current_stage_id uuid;
ALTER TABLE api.lead_stages ADD CONSTRAINT lead_stages_current_stage_id_funnel_stages_id_fk
  FOREIGN KEY (current_stage_id) REFERENCES api.funnel_stages(id);
EOF

# Paso 3: rebuild de la imagen para que Drizzle tracking registre la migración
docker build -t dm-api:local -f apps/api/Dockerfile .

# Paso 4: drop del trigger (ya existía del paso 1) para que Drizzle lo recree
docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n \
  -c "DROP TRIGGER IF EXISTS trg_sync_lead_stage_id ON api.lead_stages;"

# Paso 5: correr el servicio de migración (ahora sí aplica 0002)
docker service update --force --detach=true --image dm-api:local n8n_api-migrate
# Resultado: [migrate] apply 0002_polite_groot — done — 1 migration(s) applied
```

**Tablas creadas:**
- `api.funnel_stages` — definición del funnel (A/MS/B/C/D)
- `api.stage_flows` — flows de ManyChat por etapa (con A/B testing ponderado)
- `api.followup_templates` — secuencias de reactivación por etapa
- `api.lead_followup_log` — log inmutable de follow-ups enviados
- `api.lead_crons` — estado del detector de inactividad por conversación
- `api.stage_transitions` — historial inmutable de cambios de etapa
- **Columna:** `api.lead_stages.current_stage_id` (FK a `funnel_stages`, sincronizada por trigger)
- **Trigger:** `trg_sync_lead_stage_id` — mantiene `current_stage_id` sincronizado con `current_stage`

---

### 1.2 Seed de Quantum Creators

**Archivo:** `packages/db/drizzle/seed_qc_funnel.sql`

Tenant activo: slug `revolicord`, UUID `9d338f06-59c6-47bd-b3d7-4e3631ff4e75`

```bash
TENANT_ID="9d338f06-59c6-47bd-b3d7-4e3631ff4e75"
sed "s/<TENANT_ID>/$TENANT_ID/g" packages/db/drizzle/seed_qc_funnel.sql | \
  docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n
```

**IDs de etapas creadas:**

| Etapa | UUID |
|-------|------|
| A — Enganche | `9719f172-c902-4b28-85a4-3affcd0db12e` |
| MS — VSL | `dedf46b8-965a-4d19-97f4-fecff3c5dbcd` |
| B — Calendly | `18a733d0-7af7-41e6-a2fb-c32a26bc69a3` |
| C — Llamada agendada | `f8f2cb25-7a48-4ddc-ac96-0edcaa3ae82c` |
| D — Cliente | `4067c7db-722f-4321-beae-6b2d31e5cf85` |

**Templates de follow-up creados:** 9 en total (3 para A, 3 para MS, 2 para B, 1 para C)

**Nota:** Los `stage_flows` para A y MS quedaron con placeholders:
- `PENDIENTE_ns_video_hook` (etapa A)
- `PENDIENTE_ns_video_vsl` (etapa MS)

Hay que actualizarlos con los ns reales de ManyChat cuando los flows estén activos (ver Sección 4).

---

### 1.3 System prompt y Calendly URL cargados en el tenant

```bash
PROMPT_TEXT=$(awk '/^```$/{p++} p==1 && !/^```/{print} p==2{exit}' n8n/prompts/setter-v1.md)

docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n << PSQL
UPDATE api.tenants
SET config = config
  || jsonb_build_object('system_prompt', \$sys\$${PROMPT_TEXT}\$sys\$::text)
  || jsonb_build_object('calendly_url', 'https://quantumcreators.es/llamada-de-discovery')
WHERE id = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75';
PSQL
```

**Resultado:** `system_prompt` de 8,855 caracteres + `calendly_url` cargados.

**Pendiente:** el prompt contiene `{{QC_PRODUCT_ONELINER}}` y `{{QC_PRODUCT_NOTAS}}` — solo Alex sabe el copy real. Ver Sección 4.

---

### 1.4 agent-run actualizado (ID: 6QJs9dHcR8NX8MZe)

**Estado anterior:** 9 nodos — `Webhook → Build Context → AI Agent → enviar texto → Code → Callback`

**Estado nuevo:** 15 nodos — cadena completa con contexto dual (ADR-0010/0011/0013)

```
Webhook ─┬─► Get Stage Config          ─┐
         └─► Get Subscriber CRM Context ─┘
                  └─► Combine Contexts (Merge append)
                            └─► Build Context (runOnceForAllItems)
                                  └─► AI Agent (Claude Sonnet 4.6)
                                        └─► enviar texto (ManyChat sendContent)
                                              └─► Upsert Lead Cron
                                                    └─► Mark Followups Responded
                                                          └─► Code in JavaScript
                                                                └─► Callback
```

**Nodos nuevos:**
- **Get Stage Config** — lee `funnel_stages` + `stage_flows` para la etapa actual del lead. Parámetros: `$1` = `tenant_id`, `$2` = `lead_stage`. Conectado directamente a Webhook (recibe `$json.body.tenant.id`, `$json.body.subscriber.lead_stage`).
- **Get Subscriber CRM Context** — lee `lead_crons` + `lead_followup_log` para esta conversación. Parámetros: `$1` = `subscriber_id`, `$2` = `conversation_id`. Usa `$('Webhook').first().json` para los valores.
- **Combine Contexts** — Merge en modo `append` que garantiza que ambas queries Postgres completen antes de Build Context.
- **Build Context** (actualizado) — ya no tiene `FLOW_MAP` hardcodeado. Lee stage config y CRM desde los nodos anteriores. Produce `tenantDbId` en el output.
- **Upsert Lead Cron** — UPSERT en `lead_crons` con la etapa actual y el próximo follow-up. Se ejecuta tras enviar el mensaje al lead.
- **Mark Followups Responded** — marca follow-ups previos como `responded` cuando el lead contesta.

**Publicado y activo** vía MCP (`publish_workflow`).

---

### 1.5 followup-runner activado (ID: hEXWrZBCqNyZGf2v)

Creado en sesión anterior, activado en esta. Corre cada 5 minutos, detecta leads con `next_followup_at <= NOW()` y envía el follow-up programado.

Credenciales Postgres auto-asignadas: `Postgres account`.

---

### 1.6 Servicios Docker actualizados

```bash
# Rebuild de imagen
docker build -t dm-api:local -f apps/api/Dockerfile .

# Actualizar servicios API
docker service update --force --detach=true --image dm-api:local n8n_api
docker service update --force --detach=true --image dm-api:local n8n_api-worker
```

---

### 1.7 Git — commit y push

```
commit 4600b54
feat(mvp): migración 0002 aplicada, seed QC, agent-run + followup-runner activos
```

Pusheado a `origin/master` en `revolicord/n8n-production-stack`.

También se añadió `graphify-out/` al `.gitignore`.

---

## 2. Estado actual del sistema

| Componente | Estado |
|---|---|
| Migración `0002_polite_groot` | ✅ Aplicada y registrada en Drizzle |
| Seed QC (etapas + templates) | ✅ Corrido |
| Backfill `current_stage_id` | ⚠️ Parcial — solo leads con etapa en funnel_stages (el único lead existente tiene `current_stage = 'contactado'`, sin correspondencia en funnel) |
| `tenants.config.system_prompt` | ✅ Cargado (con placeholders `{{QC_PRODUCT_*}}` pendientes) |
| `tenants.config.calendly_url` | ✅ `https://quantumcreators.es/llamada-de-discovery` |
| `agent-run` (15 nodos) | ✅ Activo |
| `followup-runner` (14 nodos) | ✅ Activo |
| `dm-api:local` imagen | ✅ Rebuilt con migración 0002 |
| Servicios `n8n_api` / `n8n_api-worker` | ✅ Actualizados |
| GitHub `master` | ✅ commit `4600b54` |

---

## 3. Lo que falta antes del test end-to-end

### 3.1 Verificar credencial Anthropic en n8n UI (CRÍTICO)

Al actualizar `agent-run` con el SDK, el nodo `Anthropic Chat Model` puede haber perdido su credencial. Hay que verificarlo manualmente:

1. Ir a `https://paneln8n.revolicord.com/workflow/6QJs9dHcR8NX8MZe`
2. Abrir el nodo `Anthropic Chat Model`
3. Verificar que tiene la credencial Anthropic asignada
4. Si no la tiene, seleccionar la credencial existente y guardar
5. Publicar el workflow de nuevo (toggle OFF → ON, o botón "Save" + "Publish")

Lo mismo aplica para `Postgres Chat Memory` — verificar que tiene `Postgres account` asignado.

### 3.2 Actualizar flow_ns reales en stage_flows

Los flows de ManyChat para las etapas A y MS tienen namespaces placeholder. Cuando actives los flows en ManyChat:

```sql
-- Conectar al postgres del Swarm:
docker exec -it $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n

-- Etapa A (video enganche 25s):
UPDATE api.stage_flows
SET flow_ns = 'content_NS_REAL_AQUI'
WHERE stage_id = '9719f172-c902-4b28-85a4-3affcd0db12e'
  AND flow_ns = 'PENDIENTE_ns_video_hook';

-- Etapa MS (VSL 1:58):
UPDATE api.stage_flows
SET flow_ns = 'content_NS_REAL_AQUI'
WHERE stage_id = 'dedf46b8-965a-4d19-97f4-fecff3c5dbcd'
  AND flow_ns = 'PENDIENTE_ns_video_vsl';
```

El `ns` de cada flow lo ves en ManyChat → Flow → "Share" o en la URL del flow. Tiene el formato `content20260511152354_558165`.

### 3.3 Rellenar placeholders del prompt (solo Alex)

El system_prompt en `tenants.config` tiene dos placeholders sin rellenar:
- `{{QC_PRODUCT_ONELINER}}` — frase de 1 línea que describe Quantum Creators
- `{{QC_PRODUCT_NOTAS}}` — notas adicionales sobre el producto para el agente

Para actualizarlo, primero editar `n8n/prompts/setter-v1.md` en git con el texto real, luego recargar con:

```bash
PROMPT_TEXT=$(awk '/^```$/{p++} p==1 && !/^```/{print} p==2{exit}' n8n/prompts/setter-v1.md)
docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n << PSQL
UPDATE api.tenants
SET config = jsonb_set(config, '{system_prompt}', to_jsonb(\$sys\$${PROMPT_TEXT}\$sys\$::text))
WHERE id = '9d338f06-59c6-47bd-b3d7-4e3631ff4e75';
PSQL
```

---

## 4. Cómo hacer el test end-to-end (happy path)

### 4.1 Verificaciones previas

```bash
# 1. Ver que los servicios están corriendo
docker service ls | grep n8n_

# 2. Ver logs del API worker (recibe DMs de ManyChat)
docker service logs n8n_api-worker --tail=50 -f

# 3. Verificar que agent-run está activo en n8n
# https://paneln8n.revolicord.com/workflow/6QJs9dHcR8NX8MZe
# El toggle debe estar en ON (verde)
```

### 4.2 Flujo esperado al enviar un DM

```
Instagram DM recibido
  → ManyChat webhook → POST https://api.revolicord.com/webhook/manychat
  → API: debounce 15s → BullMQ job
  → Worker: acquire turn lock → drain buffer → POST https://paneln8n.revolicord.com/webhook/agent-run
  → n8n agent-run:
      Get Stage Config     (lee etapa del lead desde funnel_stages)
      Get CRM Context      (lee historial de follow-ups)
      Build Context        (construye system_prompt completo)
      AI Agent             (Claude Sonnet 4.6 procesa + puede llamar tools)
      enviar texto         (POST ManyChat sendContent → DM al usuario)
      Upsert Lead Cron     (programa próximo follow-up)
      Mark Followups Resp  (marca follow-ups previos como respondidos)
      Callback             (POST /admin/turn-completed → libera lock)
```

### 4.3 Secuencia del happy path para llegar a etapa D

| Paso | Acción del lead | Respuesta esperada del agente | Tool del agente |
|------|----------------|-------------------------------|-----------------|
| 1 | Primer DM (cualquier texto) | Saludo + envía flow del video de enganche (etapa A) | `activar_flow(content_ns_video_hook)` + `set_stage("A", ...)` |
| 2 | "Ya lo vi" / 👍 después de pregunta | Muestra entusiasmo + manda VSL (etapa MS) | `activar_flow(content_ns_video_vsl)` + `set_stage("MS", ...)` |
| 3 | Reacción positiva a la VSL | Confirma interés + envía link de Calendly | `set_stage("B", ...)` |
| 4 | "Ya agendé" / confirma reserva | Confirma la llamada + etapa C | `set_stage("C", ...)` |
| 5 | Sistema detecta booking en Calendly | (automatizado externamente — D lo marca el sistema, no el agente) | — |

### 4.4 Cómo verificar que funcionó en la DB

```sql
-- Conectar al postgres:
docker exec -it $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n

-- Ver etapa actual del lead:
SELECT s.ig_username, ls.current_stage, ls.current_stage_id, ls.updated_at
FROM api.lead_stages ls
JOIN api.subscribers s ON s.id = ls.subscriber_id;

-- Ver historial de cambios de etapa:
SELECT st.from_stage, st.to_stage, st.reason, st.agent_evidence, st.created_at
FROM api.stage_transitions st
ORDER BY st.created_at DESC LIMIT 10;

-- Ver lead_crons (próximos follow-ups):
SELECT lc.next_followup_at, lc.next_sequence_number, lc.is_active, fs.slug AS stage
FROM api.lead_crons lc
JOIN api.funnel_stages fs ON fs.id = lc.current_stage_id
ORDER BY lc.next_followup_at;
```

### 4.5 Cómo ver el log de ejecución de n8n

En la UI de n8n: `https://paneln8n.revolicord.com/workflow/6QJs9dHcR8NX8MZe`
→ pestaña "Executions" → ver la ejecución más reciente → expandir cada nodo para ver entrada/salida.

---

## 5. Pendiente para próximas sesiones

### P0 — Para que el agente funcione correctamente
- [ ] Verificar credencial Anthropic en nodo `Anthropic Chat Model` del agent-run
- [ ] Rellenar `{{QC_PRODUCT_ONELINER}}` y `{{QC_PRODUCT_NOTAS}}` en el prompt
- [ ] Actualizar `stage_flows` con los ns reales de ManyChat (flows A y MS)
- [ ] Confirmar URL real de Calendly (la actual `quantumcreators.es/llamada-de-discovery` es un placeholder)

### P1 — Para producción estable
- [ ] Añadir `instagram_context.last_seen` y `last_interaction` al payload del webhook (el API aún no los envía)
- [ ] Señales previas del agente (`sub.metadata.signals`) — persistencia en turnos
- [ ] Dashboard para que Alex edite textos de follow-ups sin tocar SQL

### P2 — Optimizaciones post-MVP
- [ ] A/B testing con pesos reales en `stage_flows`
- [ ] Métricas de conversión por etapa en n8n executions
- [ ] Evaluar cambiar `lead_stage` default de 'contactado' a 'A' en el schema (tabla `lead_stages`)

---

## 6. Referencia rápida — IDs y URLs

| Recurso | Valor |
|---|---|
| Tenant UUID | `9d338f06-59c6-47bd-b3d7-4e3631ff4e75` |
| Tenant slug | `revolicord` |
| agent-run ID | `6QJs9dHcR8NX8MZe` |
| agent-run URL | `https://paneln8n.revolicord.com/workflow/6QJs9dHcR8NX8MZe` |
| agent-run webhook (prod) | `https://paneln8n.revolicord.com/webhook/agent-run` |
| followup-runner ID | `hEXWrZBCqNyZGf2v` |
| followup-runner URL | `https://paneln8n.revolicord.com/workflow/hEXWrZBCqNyZGf2v` |
| n8n UI | `https://paneln8n.revolicord.com` |
| API pública | `https://api.revolicord.com` |
| Etapa A UUID | `9719f172-c902-4b28-85a4-3affcd0db12e` |
| Etapa MS UUID | `dedf46b8-965a-4d19-97f4-fecff3c5dbcd` |
| Etapa B UUID | `18a733d0-7af7-41e6-a2fb-c32a26bc69a3` |
| Etapa C UUID | `f8f2cb25-7a48-4ddc-ac96-0edcaa3ae82c` |
| Etapa D UUID | `4067c7db-722f-4321-beae-6b2d31e5cf85` |

---

## 7. Cómo conectarse a Postgres desde el host

El contenedor Postgres no tiene puerto expuesto. Siempre acceder así:

```bash
# Consola interactiva:
docker exec -it $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n

# Ejecutar un SQL desde archivo:
docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n < archivo.sql

# Ejecutar un SQL inline:
docker exec -i $(docker ps -q -f name=n8n_postgres) psql -U n8n -d n8n -c "SELECT ..."
```
