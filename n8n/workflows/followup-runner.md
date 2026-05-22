# Workflow: followup-runner

**ADR:** ADR-0011, ADR-0012, ADR-0015  
**Trigger:** Schedule — cada 5 minutos  
**Propósito:** Detectar leads inactivos, enviar el siguiente follow-up de su secuencia, registrar en `lead_followup_log` e `n8n_chat_histories`, y archivar cuando se agota la secuencia.

---

## Diagrama de nodos

```
[Schedule Trigger: cada 5 min]
  └─► [PG] Get Due Leads          ← lead_crons WHERE next_followup_at <= NOW()
        └─► Split in Batches (1 item/batch)
              └─► IF: ¿hay template? (ft.template_id NOT NULL)
                    ├─ SÍ
                    │    └─► IF: type == 'text'
                    │          ├─ texto → [HTTP] sendContent (ManyChat)
                    │          └─ flow  → [HTTP] sendFlow (ManyChat)
                    │                └─► [PG] Insert lead_followup_log
                    │                      └─► [PG] Insert n8n_chat_histories  (ADR-0012)
                    │                            └─► [PG] Update lead_crons (avanzar o archivar)
                    └─► NO → [PG] Archivar lead_crons (max_followups alcanzado)
```

---

## Nodo 1: Get Due Leads (Postgres)

Obtiene los leads con follow-up vencido incluyendo el template actual y el siguiente:

```sql
SELECT
  lc.id                              AS cron_id,
  lc.tenant_id,
  lc.subscriber_id,
  lc.conversation_id,
  lc.current_stage_id,
  lc.next_sequence_number,
  s.manychat_subscriber_id,
  s.display_name,
  t.config->>'manychat_api_key'      AS mc_api_key,
  fs.max_followups,
  fs.slug                            AS stage_slug,
  ft.id                              AS template_id,
  ft.type                            AS followup_type,
  ft.text_template,
  ft.flow_ns                         AS followup_flow_ns,
  ft.description                     AS followup_description,
  ft_next.delay_minutes              AS next_delay_minutes
FROM api.lead_crons lc
JOIN api.subscribers    s   ON s.id    = lc.subscriber_id
JOIN api.tenants        t   ON t.id    = lc.tenant_id
JOIN api.funnel_stages  fs  ON fs.id   = lc.current_stage_id
LEFT JOIN api.followup_templates ft ON
  ft.stage_id        = lc.current_stage_id
  AND ft.sequence_number = lc.next_sequence_number
  AND ft.is_active   = TRUE
LEFT JOIN api.followup_templates ft_next ON
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

## Nodo 2: IF — ¿Hay template?

Condición: `{{ $json.template_id !== null && $json.template_id !== undefined }}`

- **Sí** → continuar con el envío
- **No** → archivar el cron (secuencia agotada)

---

## Nodo 3a: HTTP sendContent (ManyChat) — tipo 'text'

```
POST https://api.manychat.com/fb/sending/sendContent
Headers:
  Authorization: Bearer {{ $json.mc_api_key }}
  Content-Type: application/json
Body:
  {
    "subscriber_id": "{{ $json.manychat_subscriber_id }}",
    "data": {
      "version": "v2",
      "content": {
        "type": "instagram",
        "messages": [
          {
            "type": "text",
            "text": "{{ $json.text_template.replace('{{name}}', $json.display_name) }}"
          }
        ]
      }
    }
  }
```

---

## Nodo 3b: HTTP sendFlow (ManyChat) — tipo 'flow'

```
POST https://api.manychat.com/fb/sending/sendFlow
Headers:
  Authorization: Bearer {{ $json.mc_api_key }}
  Content-Type: application/json
Body:
  {
    "subscriber_id": "{{ $json.manychat_subscriber_id }}",
    "flow_ns": "{{ $json.followup_flow_ns }}"
  }
```

---

## Nodo 4: Insert lead_followup_log (Postgres)

```javascript
// Código para construir el texto interpolado antes del INSERT
const textoEnviado = $json.followup_type === 'text'
  ? $json.text_template.replace('{{name}}', $json.display_name ?? '')
  : `[flow: ${$json.followup_flow_ns}] — ${$json.followup_description ?? ''}`;
```

```sql
INSERT INTO api.lead_followup_log
  (tenant_id, subscriber_id, conversation_id, stage_id, template_id,
   sequence_number, text_sent, status)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, 'sent');
-- $1=tenant_id, $2=subscriber_id, $3=conversation_id,
-- $4=current_stage_id, $5=template_id,
-- $6=next_sequence_number, $7=texto_interpolado
```

---

## Nodo 5: Insert n8n_chat_histories (ADR-0012)

Inserta el follow-up en la memoria conversacional del agente para que lo vea en el próximo turno:

```javascript
// Código para construir el contenido del mensaje de memoria
const textoParaMemoria = $json.followup_type === 'text'
  ? $json.text_template.replace('{{name}}', $json.display_name ?? '')
  : `[flow: ${$json.followup_flow_ns}] — ${$json.followup_description ?? ''}`;

const contenidoMemoria = `[SEGUIMIENTO AUTOMÁTICO #${$json.next_sequence_number}] ${textoParaMemoria}`;
```

```sql
INSERT INTO n8n_chat_histories (session_id, message)
VALUES (
  $1,
  jsonb_build_object(
    'type', 'ai',
    'data', jsonb_build_object(
      'content',           $2,
      'additional_kwargs', '{}'::jsonb
    )
  )
);
-- $1 = manychat_subscriber_id (el session_id usado por el agente — ver ADR-0009)
-- $2 = contenidoMemoria ('[SEGUIMIENTO AUTOMÁTICO #N] texto...')
```

> **Por qué usar `manychat_subscriber_id` como `session_id`**: es el mismo valor que usa el nodo `Postgres Chat Memory` del agente. Ver ADR-0009.

---

## Nodo 6: Update lead_crons — avanzar o archivar (Postgres)

```sql
UPDATE api.lead_crons SET
  next_sequence_number = CASE
    WHEN $1 IS NOT NULL THEN next_sequence_number + 1
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
-- $1 = ft_next.delay_minutes (NULL si no hay template siguiente → archivar)
-- $2 = cron_id (lead_crons.id)
```

---

## Nodo 6b: Archivar lead_crons (rama NO del IF — Postgres)

Cuando no existe template para `next_sequence_number` (secuencia agotada):

```sql
UPDATE api.lead_crons SET
  is_active      = FALSE,
  archived_at    = NOW(),
  archive_reason = 'max_followups',
  updated_at     = NOW()
WHERE id = $1;
-- $1 = cron_id
```

---

## Endpoint `archive_conversation` — herramienta del agente (ADR-0013)

El agente puede archivar manualmente con la tool `archive_conversation`:

```
POST /admin/conversations/:conversationId/archive
Authorization: Bearer {{ callbackToken }}
Body: { "reason": "descripción del agente" }
```

El endpoint ejecuta:

```sql
UPDATE api.lead_crons SET
  is_active      = FALSE,
  archived_at    = NOW(),
  archive_reason = 'agent_decision'
WHERE conversation_id = $1;
```

---

## Instrucción para el system prompt (ADR-0012)

Agregar en `setter-v1.md` y luego copiar al Set node `System Prompt` (campo `staticPrompt`) del workflow `agent-run`:

> *"Si ves en tu historial mensajes con el prefijo `[SEGUIMIENTO AUTOMÁTICO #N]`, significa que el sistema envió esos mensajes de forma automática mientras el lead no respondía. No los menciones explícitamente; úsalos como contexto para calibrar tu tono."*

---

## Notas operativas

- **Límite de 50 leads por ejecución**: evita timeouts. Con volumen alto, reducir el intervalo del Schedule Trigger a 2-3 min o paralelizar con `Split in Batches` de mayor tamaño.
- **Idempotencia**: si el runner falla a mitad, el siguiente ciclo (5 min) re-procesa los leads con `next_followup_at <= NOW()`. El `INSERT lead_followup_log` no tiene constraint de unicidad por `(subscriber_id, sequence_number)` — agregar si se detectan duplicados.
- **Manejo de errores de ManyChat**: envolver el nodo HTTP en un try/catch. Si falla, insertar en `lead_followup_log` con `status = 'failed'` y no avanzar `next_sequence_number`.
