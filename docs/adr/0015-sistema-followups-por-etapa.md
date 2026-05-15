# ADR-0015: Sistema de Follow-ups por Etapa

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un funnel de ventas donde cada etapa requiere una secuencia distinta de mensajes de reactivación,  
> _facing_ la ausencia de cualquier sistema de follow-up automatizado,  
> _we decided_ modelar las secuencias como filas en `followup_templates` (N plantillas por etapa, ordenadas por `sequence_number`) ejecutadas por el workflow `followup-runner`,  
> _to achieve_ follow-ups configurables por etapa sin tocar n8n, historial completo en `lead_followup_log`, y archivado automático al agotar la secuencia,  
> _accepting_ que los tiempos de envío tienen granularidad de ~5 minutos (intervalo del Schedule Trigger).

---

## Contexto

Cuando un lead no responde, el agente no puede actuar. Se necesita:

1. Enviar mensajes de reactivación automáticos.
2. Que cada etapa del funnel tenga su propia secuencia (tono y contenido distintos).
3. Registrar qué se envió, cuándo, y si el lead respondió.
4. Archivar la conversación cuando se agota la secuencia.

---

## Decisión

### Tabla `followup_templates`

Una fila por paso de la secuencia por etapa. Dos tipos: `text` (mensaje de texto) o `flow` (flow de ManyChat con multimedia).

```sql
CREATE TABLE followup_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id        UUID NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  sequence_number INT  NOT NULL CHECK (sequence_number >= 1),
  delay_hours     INT  NOT NULL,   -- horas de silencio antes de enviar este paso
  type            TEXT NOT NULL CHECK (type IN ('text', 'flow')),
  text_template   TEXT,            -- soporta placeholder {{name}}
  flow_ns         TEXT,            -- si type='flow', el namespace de ManyChat
  description     TEXT,            -- descripción para logs y memory del agente
  is_active       BOOL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stage_id, sequence_number)
);
```

### Tabla `lead_followup_log`

Registro inmutable de cada follow-up enviado.

```sql
CREATE TABLE lead_followup_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  subscriber_id   UUID NOT NULL,
  conversation_id UUID NOT NULL,
  stage_id        UUID REFERENCES funnel_stages(id),
  template_id     UUID REFERENCES followup_templates(id),
  sequence_number INT  NOT NULL,
  text_sent       TEXT,            -- texto real enviado (ya con {{name}} interpolado)
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  status          TEXT DEFAULT 'sent' CHECK (status IN ('sent','failed','responded','skipped')),
  responded_at    TIMESTAMPTZ      -- se rellena cuando el lead vuelve a escribir
);
```

### Seed de ejemplo — secuencias para etapa "nuevo" (Quantum Revolicord)

```sql
INSERT INTO followup_templates (stage_id, tenant_id, sequence_number, delay_hours, type, text_template, description)
SELECT
  fs.id, fs.tenant_id,
  1, 24, 'text',
  'Oye {{name}}, ¿pudiste ver el video que te mandé? 👀',
  'Follow-up #1 — 24h sin respuesta'
FROM funnel_stages fs WHERE fs.slug = 'nuevo'
UNION ALL
SELECT
  fs.id, fs.tenant_id,
  2, 48, 'text',
  'Hola {{name}}, no quiero molestarte pero me gustaría saber qué te pareció 🙌',
  'Follow-up #2 — 48h adicionales sin respuesta'
FROM funnel_stages fs WHERE fs.slug = 'nuevo'
UNION ALL
SELECT
  fs.id, fs.tenant_id,
  3, 72, 'text',
  '{{name}}, último intento. Si no es el momento, sin problema. Cuando quieras aquí estaré 💪',
  'Follow-up #3 — cierre de secuencia'
FROM funnel_stages fs WHERE fs.slug = 'nuevo';
```

---

## Workflow `followup-runner`

### Diagrama de nodos

```
[Schedule Trigger: cada 5 min]
  └─► [PG] Get Due Leads          ← lead_crons WHERE next_followup_at <= NOW()
        └─► Split in Batches (1)
              └─► IF: ¿hay template?
                    ├─ SÍ (ft.template_id NOT NULL AND seq <= max_followups)
                    │    └─► IF: type == 'text'
                    │          ├─ texto → [HTTP] sendContent (ManyChat)
                    │          └─ flow  → [HTTP] sendFlow (ManyChat)
                    │                └─► [PG] Insert lead_followup_log
                    │                      └─► [PG] Insert n8n_chat_histories  ← ADR-0012
                    │                            └─► [PG] Update lead_crons (avanzar o archivar)
                    └─► NO → [PG] Archivar lead_crons (max_followups alcanzado)
```

### Query `Get Due Leads`

Ver ADR-0011 — incluye el JOIN a `followup_templates` para obtener el template de `next_sequence_number` y el siguiente (`ft_next`) para saber si hay más pasos.

### Update `lead_crons` tras envío

```sql
UPDATE lead_crons SET
  next_sequence_number = CASE
    WHEN $1 IS NOT NULL THEN next_sequence_number + 1  -- $1 = next_delay_hours
    ELSE next_sequence_number
  END,
  next_followup_at = CASE
    WHEN $1 IS NOT NULL THEN NOW() + $1 * INTERVAL '1 hour'
    ELSE NULL
  END,
  is_active      = CASE WHEN $1 IS NOT NULL THEN TRUE ELSE FALSE END,
  archived_at    = CASE WHEN $1 IS NULL THEN NOW() ELSE NULL END,
  archive_reason = CASE WHEN $1 IS NULL THEN 'max_followups' ELSE NULL END,
  updated_at     = NOW()
WHERE id = $2;
-- $1 = ft_next.delay_hours (NULL si no hay siguiente template)
-- $2 = lead_cron.id
```

### Update `lead_followup_log.status` cuando el lead responde

En `agent-run`, si `followup_history` tiene entradas con `responded_at IS NULL`, marcarlas como respondidas:

```sql
UPDATE lead_followup_log SET
  status       = 'responded',
  responded_at = NOW()
WHERE subscriber_id   = $1
  AND conversation_id = $2
  AND status          = 'sent';
```

---

## Cómo el agente sabe que debe usar `archive_conversation`

El bloque CRM (ADR-0013) incluye:

```
⚠️ Límite de seguimientos alcanzado. Si no hay interés real en este turno, usa archive_conversation.
```

El agente no decide cuándo archivar por su cuenta en base a una regla fija — usa su criterio sobre la conversación pero con la señal explícita del bloque CRM cuando está en el límite.

---

## CRUD de plantillas de follow-up

La API de Revolicord debe exponer:

| Método | Ruta | Acción |
|---|---|---|
| GET | `/admin/funnel-stages/:id/followups` | Lista la secuencia de una etapa |
| POST | `/admin/funnel-stages/:id/followups` | Crear paso de la secuencia |
| PUT | `/admin/followup-templates/:id` | Editar delay, texto, tipo |
| DELETE | `/admin/followup-templates/:id` | Soft delete (`is_active = FALSE`) |
| GET | `/admin/leads/:id/followup-history` | Historial de follow-ups de un lead |

---

## Consecuencias

**Positivas:**
- Secuencias totalmente configurables por etapa desde la UI de Revolicord, sin tocar n8n.
- `lead_followup_log` es fuente de verdad auditale: cuándo se envió, qué texto, si respondió.
- Archivar automáticamente al agotar la secuencia libera recursos (crons desactivados).
- El tipo `flow` permite mandar multimedia (audio/video) en los follow-ups, no solo texto.

**Negativas:**
- Las plantillas de texto con `{{name}}` son simples (solo nombre). Si se necesitan más variables, hay que ampliar el motor de templates.
- Si un template de tipo `flow` falla (flow_ns inválido), el runner falla silenciosamente — agregar manejo de errores con reintento o alerta.
- `sequence_number` es `UNIQUE(stage_id, sequence_number)` — reorganizar el orden requiere actualizar todos los números o usar un sistema de ordenación diferente.

---

## ADRs relacionados

- ADR-0010: Funnel stages en Postgres (define `funnel_stages`)
- ADR-0011: `lead_crons` como detector de inactividad (programa los disparos)
- ADR-0012: `followup-runner` escribe en `n8n_chat_histories`
- ADR-0013: Contexto dual del agente (usa `lead_followup_log` para el bloque CRM)
