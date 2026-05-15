# Sesión 2026-05-15 — ADRs 010–015: revisión, gaps y creación de followup-runner

Documento de sesión. Registra el estado de implementación de los ADRs 0010–0015,
lo que falta para el MVP, los comandos MCP usados, y cómo están modeladas las
etapas y follow-ups en la base de datos.

---

## 1. Contexto de la sesión

- Se hizo `git pull` desde `origin/master`. El pull trajo los ADRs 0010–0015 y
  toda la documentación generada en la sesión anterior.
- Se leyeron: `n8n/SETTER-MVP-TRACKING.md`, `docs/adr/IMPLEMENTATION-REPORT.md`,
  `docs-dm-settings/13-funnel-y-agente.md`, y todos los nodos documentados en
  `n8n/nodes/`.
- Se inspeccionó el workflow `agent-run` (ID `6QJs9dHcR8NX8MZe`) vía MCP.
- Se creó el workflow `followup-runner` (ID `hEXWrZBCqNyZGf2v`) vía MCP.

---

## 2. Estado de los ADRs 010–015

### Implementado en código ✅ — pendiente de aplicar en producción

| ADR | Descripción | Artefactos |
|-----|-------------|-----------|
| 0010 | Funnel stages en Postgres — tablas `funnel_stages` + `stage_flows` | `packages/db/src/schema.ts`, migración `0002_polite_groot.sql`, seed `seed_qc_funnel.sql`, nodo `n8n/nodes/00-get-stage-config.md` |
| 0011 | Lead crons / detector de inactividad — tabla `lead_crons` | `packages/db/src/schema.ts`, migración `0002_polite_groot.sql`, nodo `n8n/nodes/99-upsert-lead-cron.md` |
| 0012 | Follow-ups en chat memory — INSERT en `n8n_chat_histories` | Parte del workflow `followup-runner`, nodo `Build SQL` |
| 0013 | Contexto dual del agente — bloque CRM en Build Context | Nodo `n8n/nodes/00b-get-crm-context.md`, código actualizado en `n8n/nodes/01-build-context.md` |
| 0014 | Migración lead_stage a FK — columna `current_stage_id UUID FK` en `lead_stages` | `packages/db/src/schema.ts`, trigger `trg_sync_lead_stage_id` en `0002_polite_groot.sql` |
| 0015 | Sistema de follow-ups por etapa — tablas `followup_templates` + `lead_followup_log` | `packages/db/src/schema.ts`, migración, seed con 9 templates para A/MS/B/C |

### Creado en n8n vía MCP ✅

| Workflow | ID | Estado | Notas |
|----------|-----|--------|-------|
| `agent-run` | `6QJs9dHcR8NX8MZe` | Activo | Cadena actual: `Webhook → Build Context → AI Agent → enviar texto → Code (prepare callback) → Callback`. Tools: `activar_flow`, `set_stage`. Modelo: Claude Sonnet 4.6. |
| `followup-runner` | `hEXWrZBCqNyZGf2v` | **Inactivo** — activar tras migración | 14 nodos, Schedule 5 min. Cadena completa según ADR-0011/0012/0015. |

---

## 3. Gaps — lo que falta para el MVP

### 3.1 Requiere acceso al servidor (ejecutar manualmente)

**Paso 1 — Aplicar migración `0002_polite_groot.sql`:**

```bash
# Desde packages/db/ con DATABASE_URL real
DATABASE_URL="postgres://user:pass@paneln8n.revolicord.com:5432/n8n" \
  pnpm db:migrate
```

Crea las tablas: `funnel_stages`, `stage_flows`, `followup_templates`,
`lead_followup_log`, `lead_crons`. Añade `current_stage_id` a `lead_stages`.
Crea el trigger `trg_sync_lead_stage_id`.

**Paso 2 — Obtener el UUID real del tenant:**

```sql
SELECT id, slug FROM api.tenants;
```

**Paso 3 — Ejecutar seed QC** (reemplazar `<TENANT_ID>` con el UUID real):

```bash
# En packages/db/drizzle/seed_qc_funnel.sql
# Sustituir '<TENANT_ID>' por el UUID y ejecutar:
psql $DATABASE_URL -f packages/db/drizzle/seed_qc_funnel.sql
```

Crea las 5 etapas A/MS/B/C/D, 2 stage_flows (con `PENDIENTE_*` de placeholder),
y 9 followup_templates (3 para A, 3 para MS, 2 para B, 1 para C).

**Paso 4 — Backfill de `lead_stages.current_stage_id`** (para subscribers existentes):

```sql
UPDATE api.lead_stages ls
SET current_stage_id = fs.id
FROM api.funnel_stages fs
WHERE fs.slug = ls.current_stage
  AND fs.tenant_id = ls.tenant_id
  AND ls.current_stage_id IS NULL;

-- Verificar que no quedaron NULLs con etapa conocida:
SELECT ls.current_stage, COUNT(*)
FROM api.lead_stages ls
WHERE ls.current_stage_id IS NULL
GROUP BY ls.current_stage;
```

**Paso 5 — Actualizar `flow_ns` reales de ManyChat** (una vez activados los flows):

```sql
UPDATE api.stage_flows
SET flow_ns = 'content_ns_real_video_hook'
WHERE stage_id = (
  SELECT id FROM api.funnel_stages WHERE slug = 'A' AND tenant_id = '<TENANT_ID>'
) AND flow_ns = 'PENDIENTE_ns_video_hook';

UPDATE api.stage_flows
SET flow_ns = 'content_ns_real_video_vsl'
WHERE stage_id = (
  SELECT id FROM api.funnel_stages WHERE slug = 'MS' AND tenant_id = '<TENANT_ID>'
) AND flow_ns = 'PENDIENTE_ns_video_vsl';
```

**Paso 6 — Cargar system_prompt y calendly_url en el tenant:**

```sql
UPDATE api.tenants
SET config = config
  || '{"system_prompt": "<pegar contenido de n8n/prompts/setter-v1.md>"}'::jsonb
  || '{"calendly_url": "https://quantumcreators.es/llamada-de-discovery"}'::jsonb
WHERE slug = 'quantum-creators';  -- ajustar slug real
```

### 3.2 Requiere cambios en n8n UI — después de aplicar migración

**Workflow `agent-run` (ID `6QJs9dHcR8NX8MZe`):**

Orden de cambios (guías en `n8n/nodes/`):

1. **Agregar `Get Stage Config`** (Postgres, `executeQuery`) antes de `Build Context`.
   SQL y parámetros: `n8n/nodes/00-get-stage-config.md`.

2. **Agregar `Get Subscriber CRM Context`** (Postgres, `executeQuery`) en paralelo
   con `Get Stage Config`. SQL y parámetros: `n8n/nodes/00b-get-crm-context.md`.

3. **Reemplazar el JS de `Build Context`** con el código de `n8n/nodes/01-build-context.md`.
   Elimina el `FLOW_MAP` hardcodeado; usa salida de `Get Stage Config` y
   `Get Subscriber CRM Context`.

4. **Agregar `Upsert Lead Cron`** (Postgres, `executeQuery`) después de `enviar texto`.
   Dos queries: UPSERT en `lead_crons` + marcar followups previos como respondidos.
   SQL y parámetros: `n8n/nodes/99-upsert-lead-cron.md`.

**Workflow `followup-runner` (ID `hEXWrZBCqNyZGf2v`):**

1. Verificar que los nodos Postgres apuntan a la credencial correcta
   ("Postgres account" se auto-asignó).
2. **Activar el workflow** (toggle en la UI) solo después de que el seed esté corrido.

### 3.3 Requiere datos externos (solo Alex conoce)

- **Copy del producto**: rellenar `{{QC_PRODUCT_ONELINER}}` y `{{QC_PRODUCT_NOTAS}}`
  en `n8n/prompts/setter-v1.md` antes de cargar el system_prompt.
- **Flow ns reales**: activar los flows en ManyChat (actualmente STOPPED), anotar
  cada `flow_ns` y ejecutar el UPDATE de stage_flows (Paso 5 arriba).
- **Cadencia y textos de follow-up**: los 9 templates del seed tienen textos
  de ejemplo. Alex los edita directamente en `api.followup_templates` o vía
  el futuro dashboard.

---

## 4. Cómo están guardadas las etapas y follow-ups

### 4.1 Etapa actual del lead

```
api.lead_stages
  id               UUID PK
  tenant_id        UUID FK → tenants
  subscriber_id    UUID FK → subscribers
  current_stage    TEXT          ← 'A' | 'MS' | 'B' | 'C' | 'D' | 'disqualified' | ...
  current_stage_id UUID FK → funnel_stages  ← nuevo (ADR-0014), sincronizado por trigger
  updated_at       TIMESTAMPTZ
```

Una fila por (tenant, subscriber). El trigger `trg_sync_lead_stage_id` mantiene
`current_stage_id` sincronizado automáticamente cuando cambia `current_stage`.

Historial inmutable:
```
api.stage_transitions
  id              UUID PK
  tenant_id       UUID
  subscriber_id   UUID
  turn_id         UUID FK → turns  (el turno que disparó el cambio)
  from_stage      TEXT
  to_stage        TEXT
  reason          TEXT  ('agent_decision' | 'follow_up_exhausted' | ...)
  agent_evidence  TEXT  (cita textual del mensaje del usuario)
  created_at      TIMESTAMPTZ
```

### 4.2 Definición del funnel

```
api.funnel_stages
  id            UUID PK
  tenant_id     UUID FK → tenants
  slug          TEXT  ('A' | 'MS' | 'B' | 'C' | 'D')
  display_name  TEXT
  position      INT   (orden visual)
  description   TEXT  (objetivo de la etapa)
  max_followups INT   (máximo de follow-ups antes de escalar/archivar)
  is_active     BOOL

api.stage_flows  ← flows de ManyChat por etapa, con A/B testing
  id          UUID PK
  stage_id    UUID FK → funnel_stages
  tenant_id   UUID
  flow_ns     TEXT   (el namespace de ManyChat, ej. 'content20260101_000000')
  description TEXT
  weight      INT    (peso para selección ponderada; varios flows = A/B automático)
  is_active   BOOL
```

### 4.3 Follow-ups

```
api.followup_templates  ← qué mandar en cada número de follow-up por etapa
  id              UUID PK
  stage_id        UUID FK → funnel_stages
  tenant_id       UUID
  sequence_number INT   (1, 2, 3... dentro de esa etapa)
  delay_hours     INT   (horas desde el último evento antes de este follow-up)
  type            TEXT  ('text' | 'flow')
  text_template   TEXT  (puede incluir {{name}} como placeholder)
  flow_ns         TEXT  (si type='flow', el ns de ManyChat a disparar)
  description     TEXT
  is_active       BOOL

api.lead_followup_log  ← registro inmutable de cada follow-up enviado
  id              UUID PK
  tenant_id       UUID
  subscriber_id   UUID
  conversation_id UUID
  stage_id        UUID FK → funnel_stages
  template_id     UUID FK → followup_templates
  sequence_number INT
  text_sent       TEXT  (texto real enviado, con {{name}} interpolado)
  sent_at         TIMESTAMPTZ
  status          TEXT  ('sent' | 'responded' | 'failed')
  responded_at    TIMESTAMPTZ  (cuando el lead respondió; lo marca Upsert Lead Cron)

api.lead_crons  ← estado del detector de inactividad por conversación
  id                    UUID PK
  tenant_id             UUID
  subscriber_id         UUID
  conversation_id       UUID
  current_stage_id      UUID FK → funnel_stages
  next_followup_at      TIMESTAMPTZ  (cuándo enviar el próximo)
  next_sequence_number  INT          (qué número de follow-up toca)
  is_active             BOOL
  archived_at           TIMESTAMPTZ
  archive_reason        TEXT  ('max_followups' | 'agent_decision' | 'lead_booked')
```

**Flujo de datos en una conversación:**

```
Lead responde → agent-run se ejecuta
  → Upsert Lead Cron: UPSERT lead_crons con next_followup_at = ahora + delay del template #1
                      + marca followups previos como 'responded' en lead_followup_log

Lead se queda en silencio → followup-runner (cron 5 min) detecta next_followup_at <= NOW()
  → Envía sendContent o sendFlow a ManyChat
  → INSERT lead_followup_log (status='sent')
  → INSERT n8n_chat_histories (para que el agente vea el contexto en el próximo turno)
  → UPDATE lead_crons: next_sequence_number++, next_followup_at = ahora + delay del template #N+1
  → Si ya no hay template siguiente: is_active=FALSE, archive_reason='max_followups'
```

---

## 5. Comandos MCP usados en esta sesión

### 5.1 Leer estado de workflows

```typescript
// Listar todos los workflows
mcp__n8n-mcp__search_workflows()

// Ver detalles completos del agent-run (nodos, conexiones, código)
mcp__n8n-mcp__get_workflow_details({ workflowId: '6QJs9dHcR8NX8MZe' })
```

### 5.2 Descubrir nodos disponibles

```typescript
mcp__n8n-mcp__search_nodes({
  queries: [
    'schedule trigger',
    'postgres',
    'split in batches',
    'if condition',
    'http request',
    'code javascript'
  ]
})
```

### 5.3 Obtener tipos exactos de parámetros

```typescript
mcp__n8n-mcp__get_node_types({
  nodeIds: [
    { nodeId: 'n8n-nodes-base.scheduleTrigger' },
    { nodeId: 'n8n-nodes-base.postgres', operation: 'executeQuery' },
    { nodeId: 'n8n-nodes-base.splitInBatches' },
    { nodeId: 'n8n-nodes-base.httpRequest' },
    'n8n-nodes-base.if',
    'n8n-nodes-base.code',
    { nodeId: 'n8n-nodes-base.code', mode: 'runOnceForAllItems' }
  ]
})
```

### 5.4 Consultar el SDK de n8n

```typescript
mcp__n8n-mcp__get_sdk_reference({ section: 'patterns' })
```

### 5.5 Validar el workflow antes de crear

```typescript
mcp__n8n-mcp__validate_workflow({ code: '<código SDK completo>' })
// Resultado: { valid: true, nodeCount: 14, warnings: [...] }
```

### 5.6 Crear el workflow `followup-runner`

```typescript
mcp__n8n-mcp__create_workflow_from_code({
  name: 'followup-runner',
  description: 'Cron cada 5 min: detecta leads inactivos en lead_crons, envía el follow-up programado (texto o flow ManyChat), registra en lead_followup_log y n8n_chat_histories, avanza o archiva el cron. ADR-0011/0012/0015.',
  code: `
import { workflow, node, trigger, ifElse, splitInBatches, nextBatch, merge, expr } from '@n8n/workflow-sdk';

// Schedule Trigger — cada 5 minutos
const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every 5 Minutes',
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
    position: [240, 300]
  },
  output: [{}]
});

// Get Due Leads — leads con next_followup_at <= NOW()
const getDueLeads = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Get Due Leads',
    parameters: {
      operation: 'executeQuery',
      query: \`SELECT lc.id AS cron_id, lc.tenant_id, lc.subscriber_id,
        lc.conversation_id, lc.current_stage_id, lc.next_sequence_number,
        s.manychat_subscriber_id, s.display_name,
        t.config->>'manychat_api_key' AS mc_api_key,
        fs.slug AS stage_slug,
        ft.id AS template_id, ft.type AS followup_type,
        ft.text_template, ft.flow_ns AS followup_flow_ns,
        ft.description AS followup_description,
        ft_next.delay_hours AS next_delay_hours
      FROM api.lead_crons lc
      JOIN api.subscribers s ON s.id = lc.subscriber_id
      JOIN api.tenants t ON t.id = lc.tenant_id
      JOIN api.funnel_stages fs ON fs.id = lc.current_stage_id
      LEFT JOIN api.followup_templates ft
        ON ft.stage_id = lc.current_stage_id
        AND ft.sequence_number = lc.next_sequence_number
        AND ft.is_active = TRUE
      LEFT JOIN api.followup_templates ft_next
        ON ft_next.stage_id = lc.current_stage_id
        AND ft_next.sequence_number = lc.next_sequence_number + 1
        AND ft_next.is_active = TRUE
      WHERE lc.is_active = TRUE
        AND lc.next_followup_at IS NOT NULL
        AND lc.next_followup_at <= NOW()
      ORDER BY lc.next_followup_at ASC LIMIT 50\`
    },
    position: [480, 300]
  },
  output: [{ cron_id: 'uuid', followup_type: 'text' }]
});

// Prepare Data — calcula textSent y chatMemoryText para cada lead
const prepareData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Data',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: \`return items.map(item => {
  const d = item.json;
  const textSent = d.followup_type === 'text'
    ? (d.text_template || '').replace(/{{name}}/g, d.display_name || '')
    : '[flow: ' + (d.followup_flow_ns || '') + '] — ' + (d.followup_description || '');
  const chatMemoryText = '[SEGUIMIENTO AUTOMÁTICO #' + d.next_sequence_number + '] ' + textSent;
  return { json: { ...d, textSent, chatMemoryText } };
});\`
    },
    position: [720, 300]
  },
  output: [{}]
});

// Loop Over Leads — 1 lead por iteración
const batchLoop = splitInBatches({
  version: 3,
  config: {
    name: 'Loop Over Leads',
    parameters: { batchSize: 1 },
    position: [960, 300]
  }
});

// Has Template? — si template_id es null, la secuencia está agotada
const ifHasTemplate = ifElse({
  version: 2.3,
  config: {
    name: 'Has Template?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('$json.template_id'),
          operator: { type: 'string', operation: 'exists' }, rightValue: '' }]
      }
    },
    position: [1200, 300]
  }
});

// Type is text? — bifurca entre sendContent y sendFlow
const ifIsText = ifElse({
  version: 2.3,
  config: {
    name: 'Type is text?',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
        combinator: 'and',
        conditions: [{ id: 'c2', leftValue: expr('$json.followup_type'),
          operator: { type: 'string', operation: 'equals' }, rightValue: 'text' }]
      }
    },
    position: [1440, 160]
  }
});

// Archive lead_crons — cuando no hay template (secuencia agotada)
const archiveLeadCrons = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: {
    name: 'Archive lead_crons',
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE api.lead_crons SET is_active = FALSE, archived_at = NOW(), archive_reason = 'max_followups', updated_at = NOW() WHERE id = $1",
      options: { queryReplacement: expr('$json.cron_id') }
    },
    position: [1440, 480]
  },
  output: [{}]
});

// sendContent — envía texto vía ManyChat API
const sendContent = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'sendContent',
    parameters: {
      method: 'POST',
      url: 'https://api.manychat.com/fb/sending/sendContent',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: expr('"Bearer " + $json.mc_api_key') }] },
      sendBody: true, contentType: 'json', specifyBody: 'json',
      jsonBody: expr("JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, data: { version: 'v2', content: { type: 'instagram', messages: [{ type: 'text', text: $json.textSent }] } } })")
    },
    position: [1680, 60]
  },
  output: [{}]
});

// sendFlow — dispara un flow de ManyChat
const sendFlow = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'sendFlow',
    parameters: {
      method: 'POST',
      url: 'https://api.manychat.com/fb/sending/sendFlow',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: expr('"Bearer " + $json.mc_api_key') }] },
      sendBody: true, contentType: 'json', specifyBody: 'json',
      jsonBody: expr("JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, flow_ns: $json.followup_flow_ns })")
    },
    position: [1680, 360]
  },
  output: [{}]
});

// After Send — merge para que ambas ramas converjan
const mergeAfterSend = merge({
  version: 3.2,
  config: { name: 'After Send', parameters: { mode: 'append' }, position: [1920, 220] }
});

// Build SQL — construye los 3 SQL strings desde $('Loop Over Leads').first().json
const buildSql = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Build SQL',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: \`const pd = $('Loop Over Leads').first().json;
const esc = s => String(s || '').replace(/'/g, "''");
const stageId   = pd.current_stage_id ? "'" + pd.current_stage_id + "'" : 'NULL';
const templateId = pd.template_id    ? "'" + pd.template_id    + "'" : 'NULL';
const delayHours = pd.next_delay_hours;

const logSql = "INSERT INTO api.lead_followup_log (tenant_id, subscriber_id, conversation_id, stage_id, template_id, sequence_number, text_sent, status) VALUES ('" + pd.tenant_id + "','" + pd.subscriber_id + "','" + pd.conversation_id + "'," + stageId + "," + templateId + "," + pd.next_sequence_number + ",'" + esc(pd.textSent) + "','sent')";

const histSql = "INSERT INTO n8n_chat_histories (session_id, message) VALUES ('" + pd.manychat_subscriber_id + "', jsonb_build_object('type','ai','data',jsonb_build_object('content','" + esc(pd.chatMemoryText) + "','additional_kwargs','{}'))::jsonb)";

const updateSql = delayHours
  ? "UPDATE api.lead_crons SET next_sequence_number = next_sequence_number + 1, next_followup_at = NOW() + INTERVAL '" + parseInt(delayHours) + " hours', is_active = TRUE, archived_at = NULL, archive_reason = NULL, updated_at = NOW() WHERE id = '" + pd.cron_id + "'"
  : "UPDATE api.lead_crons SET is_active = FALSE, archived_at = NOW(), archive_reason = 'max_followups', updated_at = NOW() WHERE id = '" + pd.cron_id + "'";

return [{ json: { logSql, histSql, updateSql } }];\`
    },
    position: [2160, 220]
  },
  output: [{}]
});

// Insert followup log, Insert chat history, Update lead_crons
const execLogSql    = node({ type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Insert followup log',
    parameters: { operation: 'executeQuery', query: expr('$json.logSql') }, position: [2400, 220] }, output: [{}] });
const execHistSql   = node({ type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Insert chat history',
    parameters: { operation: 'executeQuery', query: expr('$json.histSql') }, position: [2640, 220] }, output: [{}] });
const execUpdateSql = node({ type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Update lead_crons',
    parameters: { operation: 'executeQuery', query: expr('$json.updateSql') }, position: [2880, 220] }, output: [{}] });

export default workflow('followup-runner', 'followup-runner')
  .add(scheduleTrigger)
  .to(getDueLeads)
  .to(prepareData)
  .to(batchLoop
    .onEachBatch(
      ifHasTemplate
        .onTrue(
          ifIsText
            .onTrue(sendContent.to(mergeAfterSend.input(0)))
            .onFalse(sendFlow.to(mergeAfterSend.input(1)))
        )
        .onFalse(archiveLeadCrons.to(nextBatch(batchLoop)))
    )
  )
  .add(mergeAfterSend)
  .to(buildSql)
  .to(execLogSql)
  .to(execHistSql)
  .to(execUpdateSql)
  .to(nextBatch(batchLoop));
`
})

// Resultado:
// {
//   workflowId: 'hEXWrZBCqNyZGf2v',
//   name: 'followup-runner',
//   nodeCount: 14,
//   url: 'https://paneln8n.revolicord.com/workflow/hEXWrZBCqNyZGf2v',
//   autoAssignedCredentials: [
//     { nodeName: 'Get Due Leads',       credentialName: 'Postgres account', credentialType: 'postgres' },
//     { nodeName: 'Archive lead_crons',  credentialName: 'Postgres account', credentialType: 'postgres' },
//     { nodeName: 'Insert followup log', credentialName: 'Postgres account', credentialType: 'postgres' },
//     { nodeName: 'Insert chat history', credentialName: 'Postgres account', credentialType: 'postgres' },
//     { nodeName: 'Update lead_crons',   credentialName: 'Postgres account', credentialType: 'postgres' }
//   ],
//   note: 'HTTP Request nodes (sendContent, sendFlow) no necesitan credencial — usan token dinámico desde la DB.'
// }
```

---

## 6. Estructura del workflow `followup-runner` creado

```
[Schedule: cada 5 min]
  └─► [PG] Get Due Leads          ← lead_crons WHERE next_followup_at <= NOW() LIMIT 50
        └─► [Code] Prepare Data   ← calcula textSent y chatMemoryText
              └─► [Loop] Loop Over Leads  (batchSize=1)
                    └─► [IF] Has Template?
                          ├─ SÍ → [IF] Type is text?
                          │         ├─ texto → [HTTP] sendContent (ManyChat API)  ─┐
                          │         └─ flow  → [HTTP] sendFlow (ManyChat API)     ─┤
                          │                                                         ▼
                          │                                    [Merge] After Send
                          │                                         └─► [Code] Build SQL
                          │                                               └─► [PG] Insert followup log
                          │                                                     └─► [PG] Insert chat history
                          │                                                           └─► [PG] Update lead_crons
                          │                                                                 └─► nextBatch ──┐
                          └─ NO → [PG] Archive lead_crons                                                   │
                                        └─► nextBatch ──────────────────────────────────────────────────────┘
```

**Notas de diseño:**
- `Build SQL` usa `$('Loop Over Leads').first().json` para leer los datos del lead
  actual (incluyendo `textSent`/`chatMemoryText` de `Prepare Data`), ignorando
  el response de la HTTP call.
- El `Merge` en modo `append` garantiza que `Build SQL` ejecute tras cualquiera
  de las dos ramas HTTP.
- `Insert chat history` escribe en `n8n_chat_histories` con el mismo `session_id`
  que usa `Postgres Chat Memory` del agente → el agente verá los follow-ups en su
  contexto conversacional (ADR-0012).

---

## 7. Cambios pendientes en `agent-run` (no se modificó en esta sesión)

El workflow `agent-run` **no se tocó** porque los nodos nuevos (`Get Stage Config`,
`Get Subscriber CRM Context`, `Upsert Lead Cron`) requieren que las tablas
`funnel_stages`, `stage_flows` y `lead_crons` existan en producción.

**Hacer después de aplicar la migración (Sección 3.2):**

```
Cadena actual:
  Webhook → Build Context → AI Agent → enviar texto → Code → Callback

Cadena objetivo (ADR-0010, 0011, 0013):
  Webhook ─┬─► Get Stage Config          ─┐
           └─► Get Subscriber CRM Context ─┘
                    └─► [Merge] ─► Build Context → AI Agent → enviar texto
                                                                    └─► Upsert Lead Cron → Code → Callback
```

Las specs exactas de cada nodo están en `n8n/nodes/`:
- `00-get-stage-config.md` — Postgres query para funnel_stages + stage_flows
- `00b-get-crm-context.md` — Postgres query para lead_crons + lead_followup_log
- `01-build-context.md` — JS actualizado (usa pickFlowWeighted + buildCrmBlock)
- `99-upsert-lead-cron.md` — dos queries SQL: UPSERT cron + marcar responded

---

## 8. Checklist de activación del MVP

```
[ ] 1. pnpm db:migrate en producción (con DATABASE_URL real)
[ ] 2. seed_qc_funnel.sql con TENANT_ID real
[ ] 3. Backfill current_stage_id en lead_stages
[ ] 4. Actualizar flow_ns reales en stage_flows (tras activar flows en ManyChat)
[ ] 5. Cargar system_prompt + calendly_url en tenants.config
[ ] 6. Completar copy del producto en setter-v1.md (solo Alex)
[ ] 7. Cablear nodos nuevos en agent-run UI (00, 00b, Build Context actualizado, 99)
[ ] 8. Activar workflow followup-runner (hEXWrZBCqNyZGf2v) en n8n UI
[ ] 9. Test manual end-to-end (ver n8n/SETTER-MVP-TRACKING.md §"Cómo probar")
```
