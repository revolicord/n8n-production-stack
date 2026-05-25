# 10 — Conversation State Machine
## Estados del Lead, Transiciones y Persistencia (Quantum Creators)

---

> **Propósito:** Definir formalmente la máquina de estados del lead operativa hoy. El agente decide qué hacer en función del estado actual + el último input del lead.
>
> **Funnel canónico:** Quantum Creators — 5 etapas activas `A / MS / B / C / D` + 3 estados terminales (`disqualified`, `lost`, `escalated_human_call`).
>
> **Implementación:** este modelo está implementado en `apps/api/src/routes/admin/set-stage.ts` (validación de transiciones), `packages/db/src/schema.ts` (tablas `lead_stages` + `funnel_stages` + `stage_transitions`) y `docs/n8n/stages.md` (definiciones operativas). La fuente de verdad ejecutable son esas tres ubicaciones — este doc las explica.

---

## 1. Etapas Activas

| Sigla | Nombre | Quién maneja | Qué significa |
|-------|--------|--------------|---------------|
| `A` | Initiated | bot | Lead recibió el primer mensaje + Vídeo 1 (enganche, 25 s) |
| `MS` | Media Seen | bot | Lead confirmó (verbal o emoji, tras pregunta del agente) que vio el Vídeo 1 → se le envía el audio + VSL |
| `B` | Engaged | bot | Lead reaccionó positivo a la VSL (o a contenido de B: audio presentación, imágenes de resultados, prueba social) |
| `C` | Calendly'd | bot | Lead recibió el link de Calendly |
| `D` | Booked | handoff a closer | Lead reservó en Calendly — el closer toma desde aquí |

## 2. Estados Terminales

| Estado | Quién lo marca | Significado |
|--------|----------------|-------------|
| `disqualified` | agente (vía `set_stage`) | Descalificado por el agente. `reason` ∈ `no_money`, `not_interested`, `geographic`, `no_quality`, `fake_account`. |
| `lost` | `followup-runner` (no el agente) | 8 follow-ups agotados sin respuesta. |
| `escalated_human_call` | `followup-runner` tras follow-up #5 | Notificación a Alex para llamada manual por IG. |

> `lost` y `escalated_human_call` **nunca** los marca el agente — los gestiona el cron de follow-ups.

---

## 3. Diagrama de Estados

```
                    ┌──────────────┐
                    │      A       │  ← Lead nuevo: agente envía Vídeo 1 (enganche 25s)
                    │  Initiated   │
                    └──┬────────┬──┘
       confirma ver V1 │        │ no_money / not_interested / etc
                       ▼        ▼
                ┌──────────┐   ┌────────────────┐
                │    MS    │   │ disqualified   │  (terminal)
                │Media Seen│   └────────────────┘
                │ (Audio + │
                │   VSL)   │
                └──┬────┬──┘
   reacción pos. a │    │ disq.
   la VSL          ▼    ▼
              ┌────────┐ ┌────────────────┐
              │   B    │ │ disqualified   │
              │Engaged │ └────────────────┘
              │ (audio │
              │ + img  │
              │+ texto)│
              └──┬──┬──┘
   manda Calendly│  │ disq.
                 ▼  ▼
            ┌────────┐ ┌────────────────┐
            │   C    │ │ disqualified   │
            │Calendly│ └────────────────┘
            └──┬──┬──┘
  reserva en   │  │ disq.
  Calendly o   ▼  ▼
  confirma  ┌──────┐ ┌────────────────┐
  verbal    │  D   │ │ disqualified   │
            │Booked│ └────────────────┘
            └──────┘
            (handoff a closer)

Estados terminales gestionados por cron, NO por el agente:
─ lost                  (8 follow-ups sin respuesta)
─ escalated_human_call  (tras follow-up #5 — Alex llama manualmente)
```

---

## 4. Tabla de Transiciones Válidas

Implementado en `apps/api/src/routes/admin/set-stage.ts`:

```typescript
const VALID_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  A:            ['MS', 'disqualified'],
  MS:           ['B',  'disqualified'],
  B:            ['C',  'disqualified'],
  C:            ['D',  'disqualified'],
  D:            [],
  disqualified: [],
};
```

| Desde | Evento | Hacia | Quién dispara |
|---|---|---|---|
| `A` | Lead confirma ver Vídeo 1 ("ya lo vi", "interesante", 👍 tras la pregunta) | `MS` | agente vía `set_stage` |
| `A` | Sin respuesta tras N follow-ups (cadencia A) | sigue `A`, cron avanza secuencia hasta `lost` | `followup-runner` |
| `A` → cualquiera | `no_money` / `not_interested` / `geographic` / `no_quality` / `fake_account` | `disqualified` | agente vía `set_stage` |
| `MS` | Reacción positiva tras la VSL (👍, "me encanta", "quiero saber más", "cómo funciona") | `B` | agente vía `set_stage` |
| `B` | Mensaje positivo claro → agente envía link Calendly | `C` | agente vía `set_stage` |
| `C` | Lead reserva en Calendly (webhook) **o** confirma verbalmente ("listo, ya agendé", "reservé para el martes") | `D` | webhook Calendly **o** agente vía `set_stage` |
| Cualquiera | Follow-up #5 sin respuesta | `escalated_human_call` | `followup-runner` |
| Cualquiera | Follow-up #8 sin respuesta | `lost` | `followup-runner` |

**Reglas:**
- El agente avanza **una etapa a la vez**. Saltos (`A → C`, `MS → D`) rechazados con HTTP 400 `INVALID_TRANSITION`.
- Toda transición vía `set_stage` requiere `reason` + `evidence` (cita textual del lead).
- Para `disqualified`, `reason` **debe** ser uno de: `no_money`, `not_interested`, `geographic`, `no_quality`, `fake_account` (otros valores → 400).
- `D` solo es alcanzable desde `C`. Es estado terminal del lado del bot — el closer toma el control después.

---

## 5. Contenido Asociado a Cada Etapa

Definido en la tabla `api.stage_flows`. Ver `docs/n8n/flows-catalog.md` para el catálogo vivo.

| Etapa | Flow / Contenido | Tipo | Cuándo se dispara |
|-------|------------------|------|-------------------|
| `A` | `QC_A_video_hook_v1..v4` (4 variantes, weighted) | video 25s | Al recibir primer mensaje, agente dispara `trigger_manychat_flow` con uno de los 4 |
| `MS` | `QC_MS_audio_vsl` | audio + VSL | Tras confirmar que vio V1; el audio prepara para la VSL |
| `B` | `QC_B_audio_presentacion` / `QC_B_img_resultados` / `QC_B_txt_prueba_social` | audio / img / texto | Si el lead pide más info, escepticismo o testimonios antes del Calendly |
| `B → C` | `tenant.config.calendly_url` (texto plano) | link | Tras señal positiva clara — sin flow multimedia, va por `send_text` |
| `C` / `D` | — | — | No hay contenido automático del agente |

**Selección entre variantes:** `Build Context` (n8n) hace selección **ponderada por `weight`** (no round-robin secuencial). Los pesos viven en `stage_flows.weight` y se ajustan en DB sin tocar código.

---

## 6. Persistencia del Estado

### 6.1 Dónde se guarda

| Dato | Tabla / Ubicación | Notas |
|------|-------------------|-------|
| Etapa actual del lead | `api.lead_stages.current_stage` (TEXT) + `current_stage_id` (UUID FK → `funnel_stages.id`) | Trigger `trg_sync_lead_stage_id` mantiene ambas columnas sincronizadas |
| Log de transiciones | `api.stage_transitions` | Inmutable: `from_stage`, `to_stage`, `reason`, `agent_evidence`, `turn_id`, `created_at` |
| Cron de follow-ups | `api.lead_crons` | `next_followup_at`, `next_sequence_number`, `is_active`, `archived_at`, `archive_reason` |
| Log de follow-ups enviados | `api.lead_followup_log` | Inmutable: cada envío del `followup-runner` deja una fila |
| Memoria conversacional | `n8n_chat_histories` (schema público de n8n) | Postgres Chat Memory del workflow `agent-run`. `session_id = manychat_subscriber_id` (ADR-0009) |

### 6.2 Cómo se recupera en cada turno

El nodo `Get Subscriber CRM Context` (n8n) hace JOIN entre `lead_crons`, `lead_followup_log` y `funnel_stages` para construir el bloque CRM. `Get Stage Config` resuelve los flows válidos para la etapa actual. Ambos se inyectan en el `# CONTEXTO` del system prompt (ver `docs/n8n/nodes/01-build-context.md`).

> **Close CRM:** la integración con Close es **roadmap V1+** (post-MVP). Hoy Postgres es la única fuente de verdad — Close, cuando exista, se nutrirá de Postgres, no al revés.

---

## 7. Casos Edge

| Caso | Comportamiento |
|---|---|
| Lead responde 👍 antes de tiempo (ej. justo tras el primer mensaje, sin esperar la pregunta del agente) | El agente puede avanzar si la evidencia es clara — el LLM lo evalúa con la `evidence` que pasa a `set_stage`. |
| Lead retrocede temáticamente (ej. en `B` vuelve a preguntar algo del Vídeo 1) | Responder en contexto pero **no** retroceder la etapa. Las transiciones son sólo hacia adelante o a `disqualified`. |
| Lead pide la VSL directamente sin confirmar el Vídeo 1 | El agente sigue el guión: insiste con la confirmación. La etapa solo avanza con evidencia. |
| Lead ya agendó y vuelve a escribir | Sigue en `D`. El agente trata como soporte conversacional — no reinicia funnel. |
| El agente intenta una transición no válida (ej. `set_stage("D", ...)` desde `MS`) | Endpoint responde 400 `INVALID_TRANSITION` con la lista de transiciones permitidas. El LLM ve el string de error y puede corregir. |
| `current_stage_id` queda NULL en `lead_stages` | El trigger `trg_sync_lead_stage_id` lo backfillea contra `funnel_stages` la próxima vez que se actualice `current_stage`. |

---

## 8. Cambios respecto a versión anterior

| Antes (modelo descriptivo) | Ahora (modelo operativo QC) |
|---|---|
| `NEW / OPENED / WARMING / VIDEO_SENT / AUDIO_SENT / VSL_SENT / SCHEDULED / CALL_HELD` | `A / MS / B / C / D` |
| `OBJECTION` como estado | Las objeciones se manejan en el prompt; no son estado — son flujo conversacional dentro de la misma etapa |
| `ARCHIVED_NO_RESPONSE` | `lost` (gestionado por `followup-runner` tras 8 intentos) |
| `ESCALATED` (genérico) | `escalated_human_call` (gestionado por `followup-runner` tras follow-up #5) |
| Estado en Close CRM | Estado en `api.lead_stages` (Postgres es fuente de verdad) |

---

## 9. Gaps y Preguntas Abiertas

- [ ] Confirmar cadencia exacta de follow-ups por etapa (hoy seed propone 24h/48h/72h; SETTER-MVP marca como pendiente con Alex)
- [ ] Confirmar webhook Calendly C→D (P1 — hoy `D` se marca verbalmente por el agente)
- [ ] Confirmar si el agente debe persistir señales del lead en `lead_stages.metadata` para que `Build Context` las reinyecte (P1 — pendiente en SETTER-MVP)
