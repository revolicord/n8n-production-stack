# ADR-0013: Contexto Dual del Agente — Memoria Conversacional + Bloque CRM

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ un agente IA que debe calificar leads y tomar decisiones de etapa en cada turno,  
> _facing_ el hecho de que la memoria conversacional de n8n da "qué se dijo" pero no "en qué estado CRM está este lead",  
> _we decided_ inyectar un bloque CRM estructurado en el system prompt en cada turno (además de la memoria conversacional existente),  
> _to achieve_ que el agente tenga tanto el historial narrativo como los datos cuantificados necesarios para decidir cambios de etapa, tono y archivado,  
> _accepting_ una query adicional a Postgres en cada turno y más tokens de contexto por turno.

---

## Contexto

El agente tiene acceso a `Postgres Chat Memory` (historial conversacional) pero no sabe:

- Cuántos follow-ups automáticos se han enviado sin respuesta.
- Cuándo fue el último contacto real.
- Cuántos follow-ups quedan antes de que se archive automáticamente.
- En qué etapa está el lead y qué objetivo tiene esa etapa.

Sin esta información, el agente no puede:
- Calibrar la urgencia de su respuesta (lead que vuelve tras 3 days of silence vs. lead activo).
- Decidir cuándo usar `archive_conversation`.
- Saber si quedan intentos disponibles o si debe cerrar la conversación.

---

## Decisión

### Dos capas de contexto complementarias

| Capa | Fuente | Qué aporta |
|---|---|---|
| **Memoria conversacional** | `n8n_chat_histories` via `Postgres Chat Memory` | Historial narrativo: qué se dijo, cuándo, incluyendo follow-ups automáticos (ADR-0012) |
| **Bloque CRM** | Query a `lead_crons` + `lead_followup_log` inyectada en system prompt | Datos cuantificados: etapa, follow-ups enviados, días sin respuesta, límite |

### Nodo `Get Subscriber CRM Context` (nuevo en `agent-run`)

```sql
SELECT
  lc.next_sequence_number - 1   AS followups_sent,
  lc.updated_at                 AS last_activity,
  lc.next_followup_at,
  fs.display_name               AS stage_name,
  fs.slug                       AS stage_slug,
  fs.description                AS stage_objective,
  fs.max_followups,
  COALESCE(
    json_agg(
      json_build_object(
        'seq',          lfl.sequence_number,
        'sent_at',      lfl.sent_at,
        'status',       lfl.status,
        'responded_at', lfl.responded_at,
        'text_sent',    lfl.text_sent
      ) ORDER BY lfl.sequence_number
    ) FILTER (WHERE lfl.id IS NOT NULL),
    '[]'::json
  ) AS followup_history
FROM lead_crons lc
JOIN funnel_stages fs ON fs.id = lc.current_stage_id
LEFT JOIN lead_followup_log lfl
  ON lfl.subscriber_id   = lc.subscriber_id
  AND lfl.conversation_id = lc.conversation_id
WHERE lc.subscriber_id   = $1
  AND lc.conversation_id = $2
GROUP BY lc.id, fs.display_name, fs.slug, fs.description, fs.max_followups;
-- $1 = subscriber_id (UUID interno), $2 = conversation_id
```

### Construcción del bloque CRM en `Build Context`

```javascript
const crm = $('Get Subscriber CRM Context').first()?.json ?? {};
const followupsSent  = crm.followups_sent  ?? 0;
const maxFollowups   = crm.max_followups   ?? 3;
const history        = crm.followup_history ?? [];
const stageName      = crm.stage_name      ?? currentStage;
const stageObjective = crm.stage_objective ?? '';

function buildCrmBlock(followupsSent, maxFollowups, history, stageName, stageObjective) {
  const lines = [`# ESTADO CRM DEL LEAD`];
  lines.push(`Etapa: ${stageName}${stageObjective ? ` — ${stageObjective}` : ''}`);

  if (followupsSent === 0) {
    lines.push(`Seguimientos enviados: ninguno. Es el primer contacto o acaba de responder.`);
  } else {
    lines.push(`Seguimientos enviados sin respuesta: ${followupsSent} de ${maxFollowups} máximo.`);
    history.forEach(h => {
      const daysAgo = Math.round((Date.now() - new Date(h.sent_at)) / 86400000);
      const responded = h.responded_at ? ` ← respondió` : ` (sin respuesta)`;
      lines.push(`  - #${h.seq} hace ${daysAgo} día(s)${responded}`);
    });
    if (followupsSent >= maxFollowups) {
      lines.push(`⚠️ Límite de seguimientos alcanzado. Si no hay interés real en este turno, usa archive_conversation.`);
    } else {
      lines.push(`Está respondiendo tras un silencio. Sé cálido; no menciones los seguimientos.`);
    }
  }
  return lines.join('\n');
}

const crmBlock = buildCrmBlock(followupsSent, maxFollowups, history, stageName, stageObjective);
// Se añade al final del contextLines antes de construir systemPrompt
contextLines.push('');
contextLines.push(crmBlock);
```

### Ejemplo de system prompt resultante (fragmento)

```
# CONTEXTO
La persona se llama: Carlos
Etapa actual: Enganche — Video de enganche 25s, pedir pulgar arriba
CONTENIDO DISPONIBLE: flow_name: "content20260511152354_558165" — video hook v1

# ESTADO CRM DEL LEAD
Etapa: Enganche — Video de enganche 25s, pedir pulgar arriba
Seguimientos enviados sin respuesta: 2 de 3 máximo.
  - #1 hace 2 día(s) (sin respuesta)
  - #2 hace 0 día(s) (sin respuesta)
Está respondiendo tras un silencio. Sé cálido; no menciones los seguimientos.
```

---

## Herramienta `archive_conversation`

El bloque CRM le da al agente la señal de cuándo archivar. La herramienta ejecuta la acción:

```json
{
  "method": "POST",
  "url": "https://api.revolicord.com/admin/conversations/{{ conversationId }}/archive",
  "headers": { "Authorization": "Bearer {{ callbackToken }}" },
  "body": {
    "reason": "{{ $fromAI('reason', 'Por qué se archiva: sin interés, agotado limite, cerrado') }}"
  }
}
```

El endpoint de Revolicord API debe actualizar:
```sql
UPDATE lead_crons SET
  is_active      = FALSE,
  archived_at    = NOW(),
  archive_reason = 'agent_decision'
WHERE conversation_id = $1;
```

---

## Consecuencias

**Positivas:**
- El agente puede tomar decisiones informadas en cualquier punto de la conversación.
- Separación clara de responsabilidades: la memoria da narrativa, el CRM da métricas.
- El bloque CRM es determinista (viene de la DB, no del LLM) — no hay alucinaciones en el estado del lead.
- El texto `⚠️ Límite alcanzado` actúa como guardrail explícito para forzar la decisión de archivar.

**Negativas:**
- ~100–200 tokens adicionales por turno en el system prompt.
- Una query adicional a Postgres por turno (paralela a `Get Stage Config`; ~5–15 ms).
- Si `lead_crons` no tiene fila para este subscriber (primera vez), el bloque CRM queda vacío. Manejar con `?? {}` y defaults.

---

## ADRs relacionados

- ADR-0012: `followup-runner` escribe en `n8n_chat_histories` (primera capa de contexto)
- ADR-0011: `lead_crons` como detector de inactividad (fuente del bloque CRM)
- ADR-0015: Sistema de follow-ups por etapa
