# 16 · Mapa de etapas y transiciones — estado real implementado

> **Propósito:** entregar al arquitecto de soluciones una vista fiel de **lo que existe hoy en código y DB**, sin mezclar con el diseño futuro de doc 13 / doc `funnel-engine.md`. Las piezas documentadas pero no implementadas se listan al final en una sección explícita de gaps.
>
> **Fuente de verdad consultada:**
> - `apps/api/src/routes/admin/set-stage.ts:13-31` — enum de etapas + matriz de transiciones válidas hard-coded.
> - `apps/api/src/services/lead-stages.ts` — persistencia (`upsertLeadStage` + `createStageTransition`).
> - `packages/db/src/schema.ts:175-224` — tablas `lead_stages`, `stage_transitions`.
> - `packages/db/src/schema.ts:249-289` — tablas `funnel_stages`, `stage_flows`.
> - `packages/db/src/schema.ts:349-373` — tabla `lead_crons` (máquina de estados paralela).
> - `n8n/nodes/02-ai-agent.md:18-25` — tools efectivamente conectadas al AI Agent.
> - `n8n/prompts/setter-v1.md` (v3 actual) — comportamiento del agente.
> - `n8n/workflows/followup-runner.md` — runner de inactividad.

---

## 1. Vista de alto nivel — dos máquinas de estado paralelas

El sistema tiene **dos máquinas de estado que conviven** sobre el mismo lead. El arquitecto debe ver ambas:

```
Máquina 1: lead_stages.current_stage    ← decide el AGENTE (tool set_stage)
Máquina 2: lead_crons.is_active         ← decide el RUNNER (cron 5 min) o el AGENTE
                                          (vía archive_conversation, NO implementada hoy)
```

Las máquinas no están acopladas en código: cambiar de etapa no toca `lead_crons`, y archivar el cron no cambia la etapa. La coordinación la asume el workflow `agent-run` cuando reescribe `lead_crons.next_followup_at` tras cada turno.

---

## 2. Máquina 1 — funnel del lead (`lead_stages.current_stage`)

### Estados

| Slug | Nombre | Tipo | Quién maneja |
|------|--------|------|--------------|
| `A`  | Initiated | inicial / por defecto | bot |
| `MS` | Media Seen | intermedio | bot |
| `B`  | Engaged | intermedio | bot |
| `C`  | Calendly'd | intermedio | bot |
| `D`  | Booked | terminal | handoff a closer (humano) |
| `disqualified` | Descalificado | terminal | bot |

> El default al primer mensaje del lead es `A` (`leadStages.currentStage.default('A')` en schema + migración `0004_stage_default_a.sql`). Antes era `'nuevo'` — quedó deprecado.

### Transiciones válidas (literal del código)

```ts
// apps/api/src/routes/admin/set-stage.ts:24-31
const VALID_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  A:            ['MS', 'disqualified'],
  MS:           ['B',  'disqualified'],
  B:            ['C',  'disqualified'],
  C:            ['D',  'disqualified'],
  D:            [],
  disqualified: [],
};
```

### Diagrama

```
                       ┌──────────────────────────────┐
                       │                              ▼
   [start] ──► (A) ──► (MS) ──► (B) ──► (C) ──► (D)  ✅ terminal
                │       │       │       │
                ▼       ▼       ▼       ▼
              (disqualified) ◄──────────┘            ✅ terminal
```

**Reglas duras enforced por la API:**

1. **No saltos.** `A → C` se rechaza con `400 INVALID_TRANSITION`.
2. **No retrocesos.** `MS → A` también rechazado.
3. **Idempotencia.** Si `from == to`, devuelve `200 { changed: false }` sin escribir.
4. **`disqualified` requiere `reason` enumerado.** Si no, `400`. Valores aceptados:
   `no_money | not_interested | geographic | no_quality | fake_account`
5. **Toda transición exige `evidence` no vacía** (cita textual del lead). Se persiste en `stage_transitions.agent_evidence`.
6. **Auditoría inmutable.** Cada llamada exitosa inserta una fila en `stage_transitions` con `from_stage`, `to_stage`, `reason`, `agent_evidence`, `turn_id`, `created_at`. Nunca se actualiza.

### Criterios semánticos por transición (del prompt v3)

| De → A | Criterio en producción |
|--------|------------------------|
| `A → MS` | Lead confirma haber visto el Vídeo 1 (verbal o emoji 👍 tras pregunta). |
| `MS → B` | Lead reacciona positivamente al VSL ("me encanta", "quiero saber más"). |
| `B → C` | El agente envía el link de Calendly como texto plano. |
| `C → D` | El lead confirma verbalmente la reserva ("listo, ya agendé"). |
| `* → disqualified` | El prompt v3 instruye **descalificación inmediata sin rebote** ante "no me interesa", precio inviable, ambigüedad prolongada. |

### Quién dispara cada transición HOY

| Mecanismo | Estado |
|-----------|--------|
| Tool `set_stage` del AI Agent | ✅ Único actor que escribe `lead_stages` en runtime. |
| Endpoint admin manual | ✅ El mismo endpoint `POST /admin/leads/:subscriberId/stage` está disponible para overrides humanos. |
| Webhook entrante de Calendly | ❌ No existe (gap §5). |
| Cron de follow-ups | ❌ No toca `lead_stages` (solo `lead_crons`). |

### Endpoint que valida y persiste

```
POST /admin/leads/:subscriberId/stage
Authorization: Bearer <N8N_CALLBACK_TOKEN>
Body: { new_stage, reason, evidence, turn_id? }

→ 200 { stage, changed: true,  from }   transición OK
→ 200 { stage, changed: false }         idempotente
→ 400 INVALID_TRANSITION                 from → new_stage no permitido
→ 400 INVALID_PAYLOAD                    reason ausente / disqualified sin reason válido
→ 401 UNAUTHORIZED
→ 404 NOT_FOUND                          subscriber no existe
```

---

## 3. Máquina 2 — ciclo de vida del follow-up (`lead_crons`)

Tabla `api.lead_crons` (ADR-0011). Una fila por `(tenant_id, subscriber_id, conversation_id)`.

### Estados (combinación de columnas)

| Estado lógico | `is_active` | `next_followup_at` | `archived_at` | `archive_reason` |
|---------------|-------------|--------------------|--------------|------------------|
| `armed`       | `TRUE`      | futura            | `NULL`       | `NULL` |
| `due`         | `TRUE`      | `<= NOW()`        | `NULL`       | `NULL` |
| `archived`    | `FALSE`     | `NULL`            | timestamp    | `'max_followups'` \| `'agent_decision'` |

### Transiciones

```
                ┌─────────────────────────────────────────────┐
                │                                             │
                ▼                                             │
   ◯ ──► (armed) ──tiempo──► (due) ──runner envía──► (armed con seq++)
   │           ▲                  │
   │           │                  └──no hay template siguiente──► (archived: max_followups)
   │       lead responde
   │       o set_stage en
   │       agent-run resetea
   │           │
   └───agente llama archive_conversation──► (archived: agent_decision)   ⚠️ no implementado hoy
```

### Quién dispara cada transición HOY

| Evento | Quién | Estado |
|--------|-------|--------|
| Crear `(armed)` tras primer turno del lead | nodo `Upsert Lead Cron` del workflow `agent-run` | ✅ documentado en `n8n/nodes/99-upsert-lead-cron.md` |
| `(armed) → (due)` | paso del tiempo | ✅ |
| `(due) → (armed con seq++)` | `followup-runner` envía el siguiente template y reescribe `next_followup_at = NOW() + delay_hours` | ✅ |
| `(due) → (archived: max_followups)` | `followup-runner` cuando no hay `followup_templates` para `next_sequence_number + 1` | ✅ |
| Resetear secuencia tras respuesta del lead | `agent-run` (upsert sobre `lead_crons` en cada turno) | ✅ |
| `(*) → (archived: agent_decision)` | tool `archive_conversation` del agente | ❌ tool no conectada al AI Agent (gap §5) |

### Punto crítico para el arquitecto

`max_followups` está fijado en `funnel_stages.max_followups DEFAULT 3` (schema), pero el comportamiento real depende de cuántas filas hay en `followup_templates` por `stage_id`. El runner no consulta `max_followups`: itera mientras haya template siguiente. Es decir, `funnel_stages.max_followups` **es informativo para el bloque CRM del prompt**, no enforcement.

---

## 4. Cómo las dos máquinas se coordinan

```
Lead manda DM ──► debounce ──► dispatch a n8n
                                    │
                                    ▼
                              ┌─ Build Context (lee lead_stages + lead_crons)
                              │
                              ▼
                          AI Agent  (2 tools conectadas)
                          │       │
                          │       └── set_stage  ─────► POST /admin/leads/:id/stage
                          │                              UPDATE lead_stages
                          │                              INSERT stage_transitions
                          │
                          └── trigger_manychat_flow ──► ManyChat API
                                  │
                                  ▼
                          Upsert Lead Cron  ─────────► UPDATE lead_crons.next_followup_at
                                                       (resetea timer)
                                  │
                                  ▼
                          Callback turn-completed ───► /admin/turn-completed
                                                       UPDATE turns, libera lock
```

```
Cron 5 min ──► followup-runner
                  │
                  ├── SELECT lead_crons WHERE next_followup_at <= NOW() AND is_active
                  ├── JOIN followup_templates por (stage_id, next_sequence_number)
                  ├── envía texto o flow vía ManyChat
                  ├── INSERT lead_followup_log
                  ├── INSERT n8n_chat_histories (ADR-0012)  ← el siguiente turno del agente lo verá
                  └── UPDATE lead_crons (avanzar seq o archivar)
```

---

## 5. Gaps — diseñado en docs, NO implementado en código

Lista exhaustiva para que el arquitecto vea la deuda entre el diseño escrito y el sistema vivo.

| # | Documentado en | Estado real | Impacto |
|---|----------------|-------------|---------|
| 1 | Etapas `lost` y `escalated_human_call` (`n8n/stages.md:24-28`, doc 13) | No están en el `enum` de `set-stage.ts`. La API las rechaza con `400`. | Tras 5 follow-ups el lead queda `archived: max_followups` en `lead_crons` pero **sigue en su `current_stage` del momento del último mensaje**, no en una etapa terminal explícita. No hay distinción semántica entre "el lead nunca contestó" y "el lead descalificó". |
| 2 | Tool `archive_conversation` (`docs/funnel-engine.md`, `n8n/nodes/01-build-context.md:52`) | El prompt v3 no la menciona; el nodo `AI Agent` solo tiene `trigger_manychat_flow` y `set_stage` conectadas. | El agente no puede archivar conversaciones por decisión propia. Solo el runner archiva (por agotamiento). |
| 3 | Webhook de Calendly (`docs-dm-settings/13-funnel-y-agente.md:316-320`) | No existe ningún endpoint `/webhook/calendly` en `apps/api/src/routes/`. | `C → D` solo se marca cuando el lead confirma la reserva verbalmente y el agente decide invocar `set_stage`. Riesgo: leads que reservan pero no contestan más quedan congelados en `C`. |
| 4 | Escalado humano (`notify_human`, tabla `notifications`, doc 13) | Tabla `notifications` no existe en `schema.ts`. Tool no conectada. | No hay mecanismo para que Alex reciba alertas estructuradas; el dashboard mencionado en doc 14 está fuera de alcance. |
| 5 | Round-robin de closers (`closers`, `send_calendly_link`, doc 13) | Tabla `closers` no existe. El link de Calendly es único por tenant (`tenant.config.calendly_url`) y se inyecta en el prompt como texto. | Asignación de closers manual; no hay balanceo. |
| 6 | 8 follow-ups + escalation día 7 (`n8n/stages.md:28`, doc 13) | `funnel_stages.max_followups DEFAULT 3`; el runner archiva por agotamiento de templates, no por número. | La cadencia es la que esté seedeada en `followup_templates`, sin escalation humano. |
| 7 | Tools `cancel_follow_ups`, `schedule_follow_up`, `mark_disqualified`, `get_lead_state`, `get_objection_bank`, `send_audio`, `send_sticker`, `send_video_hook`, `send_video_vsl` (doc 13) | Ninguna implementada. El agente solo tiene `set_stage` (cubre `mark_disqualified` con `new_stage="disqualified"`) y `trigger_manychat_flow` (cubre los envíos de media seleccionando el flow vía Build Context con round-robin ponderado). | El modelo del prompt v3 colapsa toda la interacción en estas 2 tools — es una simplificación deliberada que no está reflejada en doc 13. |
| 8 | Memoria caliente Redis `mem:{tenant}:{subscriber}` con summary (doc 13:139-156) | Memoria conversacional vive en `n8n_chat_histories` (Postgres Chat Memory node de n8n). No hay summary ni nivel caliente Redis. | Si la conversación crece mucho, contexto enviado al LLM crece linealmente. |

---

## 6. Tabla de actores y permisos

| Actor | Puede llamar | Restricción |
|-------|--------------|-------------|
| AI Agent (n8n) | `set_stage`, `trigger_manychat_flow` | Token `N8N_CALLBACK_TOKEN` Bearer. Sin restricción adicional por tenant — el subscriberId determina el tenant. |
| `followup-runner` (n8n) | `UPDATE lead_crons`, `INSERT lead_followup_log`, `INSERT n8n_chat_histories`, envío a ManyChat | Conexión Postgres directa con credenciales del workflow. No pasa por la API. |
| Webhook ManyChat | `POST /webhook/manychat` | Token ManyChat + idempotencia SHA-256. No puede tocar `lead_stages`. |
| Humano (admin / manual) | Mismo endpoint `POST /admin/leads/:id/stage` | Bearer N8N_CALLBACK_TOKEN. Hoy no hay UI; se ejecuta vía curl. |

---

## 7. Preguntas abiertas que el arquitecto debería responder

1. **¿Convergir las dos máquinas?** Hoy `lead_stages` y `lead_crons` son independientes. ¿Tiene sentido que `archived: max_followups` mueva automáticamente `current_stage` a un nuevo estado `lost`? ¿O mantenerlas separadas y resolver la pregunta "¿qué pasó con este lead?" con un join al consultar?
2. **`C → D` sin webhook.** ¿Vale con la confirmación verbal del lead detectada por el LLM, o necesitamos el webhook de Calendly para no perder reservas silenciosas?
3. **Reversibilidad.** ¿Se necesita revertir transiciones (ej. `disqualified → A` si Alex decide reactivar)? Hoy es imposible — la matriz lo bloquea y `disqualified` es terminal.
4. **Multi-conversation por subscriber.** El `UNIQUE(tenant_id, subscriber_id)` en `lead_stages` asume una conversación por lead. Si un lead reactiva tras meses, ¿reusa la etapa antigua o se reinicia?
5. **`funnel_stages.max_followups` vs templates.** Hoy es informativo y puede mentir. ¿Debería ser enforcement (CHECK en el runner) o eliminarse?
6. **Auditoría del runner.** `stage_transitions` registra los cambios de etapa, pero los envíos automáticos del runner solo viven en `lead_followup_log`. ¿Debería el runner también escribir transiciones lógicas (ej. `MS → MS [follow-up #2]`) para tener un timeline único?
