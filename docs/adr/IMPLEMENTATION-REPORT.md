# Reporte de Implementación — ADRs 0010–0015

**Fecha:** 2026-05-15  
**Decisión de diseño:** ADR-0014 Path B — `current_stage_id` se agrega a `lead_stages` (no a `subscribers`), preservando el schema existente del proyecto.  
**Seed:** Solo etapas Quantum Creators (A/MS/B/C/D) — etapas legacy `nuevo/interesado/prospecto` descartadas por obsoletas.

---

## Qué se implementó

### Base de datos — Schema Drizzle (`packages/db/src/schema.ts`)

| Tabla | ADR | Columnas clave | Estado |
|-------|-----|----------------|--------|
| `funnel_stages` | 0010 | `tenant_id`, `slug`, `display_name`, `position`, `description`, `max_followups`, `is_active` | ✅ Agregada |
| `stage_flows` | 0010 | `stage_id FK`, `tenant_id`, `flow_ns`, `weight`, `is_active` | ✅ Agregada |
| `followup_templates` | 0015 | `stage_id FK`, `sequence_number`, `delay_hours`, `type`, `text_template`, `flow_ns` | ✅ Agregada |
| `lead_followup_log` | 0015 + 0012 | `subscriber_id`, `conversation_id`, `template_id FK`, `sequence_number`, `text_sent`, `status`, `responded_at` | ✅ Agregada |
| `lead_crons` | 0011 | `subscriber_id`, `conversation_id`, `current_stage_id FK`, `next_followup_at`, `next_sequence_number`, `is_active`, `archive_reason` | ✅ Agregada |
| `lead_stages` (modificada) | 0014 | + columna `current_stage_id UUID FK → funnel_stages(id)` | ✅ Modificada |

### Migración SQL (`packages/db/drizzle/0002_polite_groot.sql`)

Generada con `pnpm db:generate` (drizzle-kit). Contiene:

- `CREATE TABLE` para las 5 tablas nuevas con FK, índices y constraints.
- `ALTER TABLE lead_stages ADD COLUMN current_stage_id UUID FK`.
- **Índice parcial** en `lead_crons`: `WHERE is_active = TRUE AND next_followup_at IS NOT NULL` — optimiza el query del followup-runner.
- **Trigger `trg_sync_lead_stage_id`** en `lead_stages`: mantiene `current_stage_id` sincronizado cuando `current_stage` cambia por texto.
- **Backfill comentado**: `UPDATE lead_stages SET current_stage_id = fs.id FROM funnel_stages fs WHERE ...` — ejecutar manualmente después del seed.

### Seed SQL (`packages/db/drizzle/seed_qc_funnel.sql`)

Script idempotente (`ON CONFLICT DO NOTHING`) con:

- **5 etapas** del funnel QC: `A` (Enganche), `MS` (VSL), `B` (Calendly), `C` (Llamada agendada), `D` (Cliente).
- **2 stage_flows** con placeholders: `PENDIENTE_ns_video_hook` (etapa A) y `PENDIENTE_ns_video_vsl` (etapa MS). Etapas B/C/D sin flow multimedia.
- **9 followup_templates** distribuidos: 3 para A, 3 para MS, 2 para B, 1 para C. Cadencia: 24h / 48h / 72h según etapa.
- Requiere reemplazar `<TENANT_ID>` con el UUID real antes de ejecutar.

### Pruebas ejecutadas en local

| Prueba | Resultado |
|--------|-----------|
| `pnpm typecheck` (3 paquetes: db, shared, api) | ✅ Exit 0 — sin errores de TypeScript |
| `pnpm db:generate` | ✅ Migración `0002_polite_groot.sql` generada correctamente, 13 tablas reconocidas |
| `pnpm db:migrate` contra Postgres de producción | ⚠️ No ejecutado — `DATABASE_URL` no disponible en local |

### Documentación de nodos n8n creada / actualizada

Todos los archivos son **specs ejecutables** (SQL + JavaScript copy-paste) listos para implementar en la UI de n8n.

| Archivo | ADR | Descripción |
|---------|-----|-------------|
| `docs/n8n/nodes/00-get-stage-config.md` | 0010 | Nodo Postgres: reemplaza `FLOW_MAP` — lee `funnel_stages + stage_flows` |
| `docs/n8n/nodes/00b-get-crm-context.md` | 0013 | Nodo Postgres: lee `lead_crons + lead_followup_log` para el bloque CRM |
| `docs/n8n/nodes/01-build-context.md` | 0010, 0013 | Actualizado: `pickFlowWeighted()` + `buildCrmBlock()` — elimina FLOW_MAP hardcodeado |
| `docs/n8n/nodes/99-upsert-lead-cron.md` | 0011 | Nodo Postgres post-respuesta: UPSERT en `lead_crons` + marca followups como respondidos |
| `docs/n8n/workflows/followup-runner.md` | 0011, 0012, 0015 | Workflow completo: Schedule Trigger → Get Due Leads → envío → log → avanzar/archivar |

---

## Adaptación Path B (ADR-0014)

El ADR asume `subscribers.lead_stage TEXT` → `subscribers.current_stage_id`. El schema real usa `lead_stages` como tabla separada. Impacto:

| ADR original | Implementado (Path B) |
|---|---|
| `ALTER TABLE subscribers ADD COLUMN current_stage_id` | `ALTER TABLE lead_stages ADD COLUMN current_stage_id` |
| Trigger en `subscribers` | Trigger en `lead_stages` |
| Queries con `sub.current_stage_id` | JOIN con `lead_stages ls ON ls.subscriber_id = sub.id` |
| Backfill desde `subscribers.lead_stage` | Backfill desde `lead_stages.current_stage` |

Las queries de `Get Subscriber CRM Context` y `Upsert Lead Cron` ya reflejan esta adaptación.

---

## Pendientes de producción — en orden de ejecución

### 1. Aplicar migración (requiere acceso al servidor)

```bash
# Desde packages/db/ con DATABASE_URL real
DATABASE_URL="postgres://user:pass@paneln8n.revolicord.com:5432/n8n" \
  pnpm db:migrate
```

Crea las 5 tablas nuevas, agrega `current_stage_id` a `lead_stages`, crea el trigger y el índice parcial.

### 2. Ejecutar seed QC (requiere tenant_id real)

```sql
-- Paso 1: obtener el tenant_id real
SELECT id, slug FROM api.tenants;

-- Paso 2: abrir seed_qc_funnel.sql, reemplazar '<TENANT_ID>' con el UUID

-- Paso 3: ejecutar el seed
\i packages/db/drizzle/seed_qc_funnel.sql
```

### 3. Confirmar y cargar los `flow_ns` reales de ManyChat

Los stage_flows del seed usan placeholders. Una vez que los flows estén activos en ManyChat:

```sql
UPDATE api.stage_flows
SET flow_ns = 'content_ns_real_aqui'
WHERE stage_id = (SELECT id FROM api.funnel_stages WHERE slug = 'A' AND tenant_id = '<TENANT_ID>')
  AND flow_ns = 'PENDIENTE_ns_video_hook';

UPDATE api.stage_flows
SET flow_ns = 'content_ns_real_aqui'
WHERE stage_id = (SELECT id FROM api.funnel_stages WHERE slug = 'MS' AND tenant_id = '<TENANT_ID>')
  AND flow_ns = 'PENDIENTE_ns_video_vsl';
```

### 4. Ejecutar backfill de `lead_stages.current_stage_id`

Después del seed (para suscriptores existentes):

```sql
UPDATE api.lead_stages ls
SET current_stage_id = fs.id
FROM api.funnel_stages fs
WHERE fs.slug = ls.current_stage
  AND fs.tenant_id = ls.tenant_id
  AND ls.current_stage_id IS NULL;

-- Verificar que no quedaron NULLs con etapa conocida
SELECT ls.current_stage, COUNT(*)
FROM api.lead_stages ls
WHERE ls.current_stage_id IS NULL
GROUP BY ls.current_stage;
```

### 5. Cablear los nodos nuevos en n8n UI (workflow `agent-run`)

Orden de cambios en la UI:

1. **Agregar nodo `Get Stage Config`** (Postgres) antes de `Build Context`. Query en `docs/n8n/nodes/00-get-stage-config.md`.
2. **Agregar nodo `Get Subscriber CRM Context`** (Postgres) en paralelo con `Get Stage Config`. Query en `docs/n8n/nodes/00b-get-crm-context.md`.
3. **Reemplazar el JavaScript de `Build Context`** con el código de `docs/n8n/nodes/01-build-context.md`. Elimina el `FLOW_MAP` hardcodeado.
4. **Agregar nodo `Upsert Lead Cron`** (Postgres) después de `enviar texto`. Queries en `docs/n8n/nodes/99-upsert-lead-cron.md`.

### 6. Crear workflow `followup-runner` en n8n

Workflow nuevo con Schedule Trigger cada 5 minutos. Implementar siguiendo `docs/n8n/workflows/followup-runner.md` (diagrama + 6 nodos + queries SQL completas).

### 7. Actualizar el system prompt

En `docs/n8n/prompts/setter-v1.md` y en el Set node `System Prompt` del workflow `agent-run` (campo `staticPrompt`, ver `docs/n8n/nodes/00c-system-prompt.md`), agregar:

> *"Si ves en tu historial mensajes con el prefijo `[SEGUIMIENTO AUTOMÁTICO #N]`, significa que el sistema envió esos mensajes de forma automática mientras el lead no respondía. No los menciones explícitamente; úsalos como contexto para calibrar tu tono."*

### 8. Activar los flows en ManyChat

Los flows están como STOPPED. Activarlos en la UI de ManyChat y anotar cada `flow_ns` para el paso 3.

---

## Resumen ejecutivo

| Categoría | Hecho | Pendiente de producción |
|-----------|-------|------------------------|
| Schema Drizzle | ✅ 5 tablas + FK + trigger + índice | Aplicar migración con `DATABASE_URL` real |
| Seed QC | ✅ Script listo | Reemplazar `<TENANT_ID>` y ejecutar |
| Docs nodos n8n | ✅ 4 nodos nuevos + `Build Context` actualizado | Copiar a la UI de n8n |
| Workflow followup-runner | ✅ Spec completo | Crear en la UI de n8n |
| ManyChat flows | N/A (configuración externa) | Activar y confirmar `flow_ns` reales |
| Backfill `current_stage_id` | ✅ SQL listo | Ejecutar después del seed |
| System prompt | ✅ Instrucción documentada | Agregar a `setter-v1.md` + `tenants.config` |
