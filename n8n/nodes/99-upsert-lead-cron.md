# Nodos: Upsert Lead Cron + Mark Followups Responded

**Tipo:** Postgres (dos nodos separados en el workflow)  
**Posición en cadena:** Después de `lead_content_sent` INSERT  
**ADR:** ADR-0011  
**Propósito:** Programar o resetear el próximo follow-up del lead (`Upsert Lead Cron`), y marcar los follow-ups automáticos previos como respondidos (`Mark Followups Responded`).

---

## Nodo 1: Upsert Lead Cron

### Query SQL (exacta del workflow)

```sql
INSERT INTO api.lead_crons (
  tenant_id, subscriber_id, conversation_id, current_stage_id,
  next_followup_at, next_sequence_number, is_active
)
SELECT
  $1::uuid, $2::uuid, $3::uuid,
  ls.current_stage_id,
  NOW() + ft.delay_hours * INTERVAL '1 hour',
  1,
  TRUE
FROM api.lead_stages ls
LEFT JOIN api.followup_templates ft
  ON ft.stage_id        = ls.current_stage_id
  AND ft.sequence_number = 1
  AND ft.is_active       = TRUE
WHERE ls.subscriber_id = $2::uuid
  AND ls.tenant_id     = $1::uuid
LIMIT 1
ON CONFLICT (tenant_id, subscriber_id, conversation_id) DO UPDATE SET
  current_stage_id     = EXCLUDED.current_stage_id,
  next_followup_at     = EXCLUDED.next_followup_at,
  next_sequence_number = 1,
  is_active            = TRUE,
  updated_at           = NOW()
```

### Parámetros (queryReplacement — comma-separated)

```
={{ $('Build Context').first().json.tenantDbId }},{{ $('Build Context').first().json.subscriberDbId }},{{ $('Build Context').first().json.conversationId }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `tenant_id` UUID | `Build Context.tenantDbId` |
| $2 | `subscriber_id` UUID | `Build Context.subscriberDbId` |
| $3 | `conversation_id` UUID | `Build Context.conversationId` |

### Lógica

- Lee `lead_stages.current_stage_id` para capturar cambios de etapa que el Router haya ejecutado durante este turno.
- `LEFT JOIN followup_templates` busca el template de sequence_number 1 para calcular `next_followup_at = NOW() + delay_hours`.
- Si no existe template (ej. etapa D sin follow-ups), `next_followup_at = NULL` — el runner no programa nada.
- `ON CONFLICT` resetea la secuencia a 1 e is_active a TRUE (el lead respondió, se reinicia el ciclo).

---

## Nodo 2: Mark Followups Responded

### Query SQL (exacta del workflow)

```sql
UPDATE api.lead_followup_log SET
  status       = 'responded',
  responded_at = NOW()
WHERE subscriber_id   = $1::uuid
  AND conversation_id = $2::uuid
  AND status          = 'sent'
```

### Parámetros (queryReplacement — comma-separated)

```
={{ $('Build Context').first().json.subscriberDbId }},{{ $('Build Context').first().json.conversationId }}
```

| $N | Campo | Fuente |
|----|-------|--------|
| $1 | `subscriber_id` UUID | `Build Context.subscriberDbId` |
| $2 | `conversation_id` UUID | `Build Context.conversationId` |

### Lógica

Cuando el lead manda un mensaje, todos los follow-ups automáticos enviados (`status = 'sent'`) se marcan como `responded`. Esto evita que el followup-runner los reintente.

---

## Cuándo se ejecutan

Estos nodos solo se alcanzan si el Router logró enviar contenido multimedia (rama false del nodo `If`). Si el agente decidió solo `reply_text` o `change_stage`, esta cadena no se ejecuta.

> **⚠️ Bug:** Al finalizar `Mark Followups Responded`, la cadena termina sin llamar al endpoint `turn-completed` del API. El turn lock nunca se libera. Pendiente añadir nodo HTTP Request al final.

---

## Notas

- `Mark Followups Responded` actualiza `lead_followup_log`, tabla distinta de `lead_content_sent`. La primera es para follow-ups automáticos (runner), la segunda para contenido enviado por el agente.
- El nodo `Execute a SQL query1` (al inicio del turno) ya marcó `lead_content_sent.lead_responded = TRUE`; este nodo marca `lead_followup_log.status = 'responded'`.
