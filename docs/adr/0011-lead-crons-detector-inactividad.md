# ADR-0011: `lead_crons` como Detector de Inactividad

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un agente IA de ventas por Instagram DM que necesita hacer seguimiento a leads que no responden,  
> _facing_ la ausencia total de un sistema de detección de inactividad y programación de follow-ups,  
> _we decided_ usar una tabla PostgreSQL `lead_crons` con un campo `next_followup_at` consultada periódicamente por un workflow `followup-runner` en n8n,  
> _to achieve_ un detector de inactividad sin dependencias externas (no BullMQ, no Temporal, no cron del SO),  
> _accepting_ una granularidad mínima de ~5 minutos (intervalo del Schedule Trigger de n8n).

---

## Contexto

Cuando un lead de Instagram deja de responder, el agente no puede actuar porque solo se activa con mensajes entrantes. Se necesita un mecanismo que:

1. Detecte cuándo un lead lleva X horas sin responder.
2. Envíe el follow-up correcto según la etapa y la secuencia.
3. Se desactive cuando el lead responde (para no mandar follow-ups a alguien activo).
4. Archive la conversación cuando se agota la secuencia.

**Opciones evaluadas:**

| Opción | Ventaja | Problema |
|---|---|---|
| Cron del SO (crontab) | Simple | Fuera del stack; no multi-tenant; sin visibilidad |
| BullMQ / Redis | Granularidad exacta | Dependencia nueva; más infra; jobs por lead = miles de entradas |
| Temporal / Inngest | Workflows duraderos | Sobre-ingeniería para este caso |
| **Tabla `lead_crons` + n8n Schedule** | Sin infra extra; visible en Postgres; auditable | Granularidad de 5 min (aceptable para seguimientos de horas) |

---

## Decisión

### Tabla `lead_crons`

Una fila por conversación activa. Esta tabla **es** el detector de inactividad.

```sql
CREATE TABLE lead_crons (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL,
  subscriber_id        UUID        NOT NULL,
  conversation_id      UUID        NOT NULL,
  current_stage_id     UUID        REFERENCES funnel_stages(id),
  next_followup_at     TIMESTAMPTZ,            -- NULL = sin follow-up programado
  next_sequence_number INT         DEFAULT 1,  -- qué template de la secuencia toca
  is_active            BOOL        DEFAULT TRUE,
  archived_at          TIMESTAMPTZ,
  archive_reason       TEXT,                   -- 'agent_decision' | 'max_followups' | 'manual'
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, subscriber_id, conversation_id)
);

-- Índice crítico para el followup-runner (solo filas activas con fecha vencida)
CREATE INDEX idx_lead_crons_due
  ON lead_crons(next_followup_at)
  WHERE is_active = TRUE AND next_followup_at IS NOT NULL;
```

### Ciclo de vida de una fila

```
Lead escribe por primera vez
  → UPSERT: next_followup_at = NOW() + delay_horas(template #1), next_sequence = 1

Lead escribe de nuevo (cualquier momento)
  → UPSERT: next_followup_at = NOW() + delay_horas(template #1), next_sequence = 1
    (reset completo — si respondió, la secuencia vuelve a empezar)

followup-runner dispara (next_followup_at <= NOW())
  → Envía follow-up #next_sequence_number
  → Si hay template siguiente:
       next_followup_at = NOW() + delay_horas(template #next+1)
       next_sequence_number += 1
  → Si no hay más templates:
       is_active = FALSE, archived_at = NOW(), archive_reason = 'max_followups'

Agente decide archivar (herramienta archive_conversation)
  → is_active = FALSE, archived_at = NOW(), archive_reason = 'agent_decision'
```

### Nodo `Upsert Lead Cron` en `agent-run`

Se ejecuta **después** de que el agente responde (post `enviar texto`). Lee la etapa actual fresca desde la DB para capturar cambios de etapa que el agente haya hecho durante el turno:

```sql
INSERT INTO lead_crons (
  tenant_id, subscriber_id, conversation_id, current_stage_id,
  next_followup_at, next_sequence_number, is_active
)
SELECT
  $1, $2, $3,
  sub.current_stage_id,
  NOW() + ft.delay_hours * INTERVAL '1 hour',
  1,
  TRUE
FROM subscribers sub
LEFT JOIN followup_templates ft
  ON ft.stage_id        = sub.current_stage_id
  AND ft.sequence_number = 1
  AND ft.is_active       = TRUE
WHERE sub.id = $2
LIMIT 1
ON CONFLICT (tenant_id, subscriber_id, conversation_id) DO UPDATE SET
  current_stage_id     = EXCLUDED.current_stage_id,
  next_followup_at     = EXCLUDED.next_followup_at,
  next_sequence_number = 1,
  is_active            = TRUE,
  updated_at           = NOW();
-- $1=tenant_id, $2=subscriber_id (UUID interno), $3=conversation_id
```

> **Por qué leer `sub.current_stage_id` desde la DB y no del payload:** si el agente llamó `set_stage` durante el turno, la DB ya tiene la nueva etapa. El UPSERT así siempre programa el follow-up correcto para la etapa post-turno.

### Workflow `followup-runner`

Schedule Trigger cada 5 minutos. Query principal:

```sql
SELECT
  lc.*,
  s.manychat_subscriber_id,
  s.display_name,
  t.config->>'manychat_api_key' AS mc_api_key,
  fs.max_followups,
  fs.slug AS stage_slug,
  ft.id             AS template_id,
  ft.type           AS followup_type,
  ft.text_template,
  ft.flow_ns        AS followup_flow_ns,
  ft_next.delay_hours AS next_delay_hours  -- NULL si es el último
FROM lead_crons lc
JOIN subscribers    s   ON s.id    = lc.subscriber_id
JOIN tenants        t   ON t.id    = lc.tenant_id
JOIN funnel_stages  fs  ON fs.id   = lc.current_stage_id
LEFT JOIN followup_templates ft ON
  ft.stage_id        = lc.current_stage_id
  AND ft.sequence_number = lc.next_sequence_number
  AND ft.is_active   = TRUE
LEFT JOIN followup_templates ft_next ON
  ft_next.stage_id       = lc.current_stage_id
  AND ft_next.sequence_number = lc.next_sequence_number + 1
  AND ft_next.is_active  = TRUE
WHERE lc.is_active        = TRUE
  AND lc.next_followup_at IS NOT NULL
  AND lc.next_followup_at <= NOW()
ORDER BY lc.next_followup_at ASC
LIMIT 50;
```

---

## Consecuencias

**Positivas:**
- Sin nueva infraestructura: usa Postgres y n8n que ya existen.
- Estado de cada lead visible en SQL: `SELECT * FROM lead_crons WHERE is_active = TRUE`.
- El reset automático al recibir un mensaje (`next_sequence = 1`) evita mandar follow-ups a alguien que ya respondió.
- La columna `archive_reason` permite distinguir archivados automáticos de decisiones del agente.

**Negativas:**
- Granularidad de 5 minutos: un follow-up programado para las 10:00 podría salir a las 10:04. Aceptable para secuencias de horas o días.
- Si n8n cae durante la ventana de disparo, el follow-up se procesa en la siguiente ejecución del Schedule Trigger (5 min de tolerancia máxima).
- Limite de 50 leads por ejecución del runner: con volumen alto habría que reducir el intervalo o paralelizar.

---

## ADRs relacionados

- ADR-0010: Funnel stages en Postgres (define `funnel_stages` y `followup_templates`)
- ADR-0012: `followup-runner` escribe en `n8n_chat_histories`
- ADR-0015: Sistema de follow-ups por etapa (`followup_templates`)
