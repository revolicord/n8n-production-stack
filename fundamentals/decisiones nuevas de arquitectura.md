# Arquitectura — DM Instagram Appointment Setter

**Versión:** 1.0
**Fecha:** 2026-05-15
**Estado:** Decisiones de arquitectura cerradas — listo para implementación

---

## 1. Objetivo

Construir un agente de IA que conversa por DM de Instagram, aplica una máquina de estados de 5 etapas y agenda citas. El agente decide cuándo responder con texto libre y cuándo ejecutar flujos pre-armados de ManyChat (contenido multimedia: video, audio, fotos, VSL).

---

## 2. Stack

| Componente | Tecnología | Rol |
|---|---|---|
| Canal | **ManyChat** | Conexión con Instagram, biblioteca de flujos multimedia |
| Orquestación | **API intermedia** (Node/Python) | Debounce, registry de flujos, router, scheduler de follow-ups |
| Cerebro | **n8n + LLM** | Agente con tools dinámicos |
| Estado | **Postgres** | Lead state, flow_registry, audit trail, follow-ups programados |
| Cache/Buffer | **Redis** | Debounce de mensajes |
| Calendario | **Calendly** | Booking + webhook de confirmación |

---

## 3. Máquina de estados

Pipeline **lineal**, sin saltos ni retrocesos:

```
A (Initiated) → MS (Media Seen) → B (Engaged) → C (Calendly'd) → D (Booked)
                                                       │
                                                       └─→ lost (8/8 follow-ups sin agendar)
```

| Código | Nombre | Quién inicia | Follow-ups | Transición de salida |
|---|---|---|---|---|
| **A** | Initiated | Setter (video + audio + VSL) o lead (1er DM) | Ninguno | LLM detecta 👍 a VSL → `advance_stage` |
| **MS** | Media Seen | Lead (👍 a VSL) | Ninguno | LLM detecta señal de interés → `advance_stage` |
| **B** | Engaged | Lead | 8 flujos ManyChat (1B–8B) | LLM decide mandar Calendly → ejecuta flujo C |
| **C** | Calendly'd | Setter (link) | 8 flujos ManyChat (1C–8C) | Webhook Calendly **OR** LLM confirma → D · 8/8 sin agendar → `lost` + handoff |
| **D** | Booked | Lead (agenda) | Ninguno | Estado terminal. Bot confirma cita, responde dudas logísticas, envía recordatorios |

### Reglas de transición

- Solo `+1` etapa por llamada a `advance_stage`. No saltos.
- Tool requiere evidencia textual + confidence ≥ `med`.
- `D` es terminal: el bot sigue respondiendo pero no avanza más.
- `lost` activa handoff humano automático.

---

## 4. Problema central resuelto: descripción de flujos al LLM

**Decisión:** Convención de nombres + Registry en Postgres (híbrido).

### 4.1 Convención de nombres en ManyChat

```
{ETAPA}_{tipo}_{slug}
```

Ejemplos:
- `A_setter_video_intro`
- `A_setter_audio_intro`
- `A_setter_vsl`
- `B_followup_1` … `B_followup_8`
- `C_setter_calendly_link`
- `C_followup_1` … `C_followup_8`
- `D_setter_recordatorio_24h`
- `SYS_handoff_humano`

El prefijo `{ETAPA}` permite:
1. Filtrar tools por etapa actual del lead (sin consultar el registry).
2. Validación de seguridad: si el LLM invoca un flujo de etapa equivocada, se rechaza.

### 4.2 Tabla `flow_registry` (Postgres)

```sql
CREATE TABLE flow_registry (
  flow_id          TEXT PRIMARY KEY,    -- ID de ManyChat
  flow_name        TEXT NOT NULL,       -- B_followup_3
  etapa            TEXT NOT NULL,       -- A | MS | B | C | D | SYS
  tool_name        TEXT NOT NULL,       -- snake_case para el LLM
  description      TEXT NOT NULL,       -- "Envía video 90s del caso de éxito..."
  when_to_use      TEXT NOT NULL,       -- "Cuando el lead muestra escepticismo"
  when_not_to_use  TEXT,                -- "Si ya se envió en esta sesión"
  content_summary  TEXT NOT NULL,       -- Resumen del contenido multimedia
  input_schema     JSONB DEFAULT '{}',  -- Params opcionales
  side_effects     TEXT[] DEFAULT '{}', -- ['set_tag:visto_caso']
  active           BOOL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flow_registry_etapa_active ON flow_registry(etapa, active);
```

### 4.3 Sync ManyChat ↔ registry

- Job programado (diario o on-demand) → `GET /fb/page/getFlows` de ManyChat.
- Parsea nombres con la convención.
- UPSERT por `flow_id` (preserva descripciones editadas a mano).
- Las descripciones semánticas (`description`, `when_to_use`, `content_summary`) **se editan manualmente** por el equipo; no se autogeneran.

---

## 5. Carga dinámica de tools por etapa

Por cada turno conversacional:

1. API recibe mensaje debounced.
2. Lee `lead.etapa` de Postgres.
3. `SELECT * FROM flow_registry WHERE etapa = $1 AND active = TRUE`.
4. Mapea cada fila a una OpenAI tool spec:
   ```json
   {
     "type": "function",
     "function": {
       "name": "send_flow_b_followup_3",
       "description": "{description}\n\nCuándo usar: {when_to_use}\nNo usar si: {when_not_to_use}\nContenido: {content_summary}",
       "parameters": "{input_schema}"
     }
   }
   ```
5. Agrega tools del sistema (siempre disponibles): `advance_stage`, `request_human_handoff`, `reply_text`.
6. Llama LLM con tools + mensaje consolidado + memoria.
7. Si LLM elige tool de flujo → API valida etapa → `POST /fb/sending/sendFlow` a ManyChat.

---

## 6. Debounce de mensajes (Redis)

**Tiempo:** 20 segundos tras el último mensaje del lead.

```
1. ManyChat → POST /inbound { user_id, message, timestamp }
2. API:
   - RPUSH buffer:{user_id} <message>
   - SET trigger:{user_id} "1" EX 20
3. Si llega otro mensaje del mismo user → refresca TTL (reinicia 20s)
4. Listener de Redis keyspace notifications detecta expiración de trigger:*
5. API consolida buffer:{user_id} → llama n8n una sola vez con el batch
6. DEL buffer:{user_id}
```

**Alternativa simple si no se configuran keyspace notifications:** poll cada 2s sobre keys con prefijo `trigger:*` y TTL ≤ 0.

---

## 7. Tools del agente

### 7.1 Dinámicos (de flow_registry)

`send_flow_{flow_name}` — generados al vuelo por cada flujo activo de la etapa actual.

### 7.2 Sistema (siempre disponibles)

#### `advance_stage`
```json
{
  "name": "advance_stage",
  "description": "Marca avance del lead. Solo cuando hay evidencia clara en la conversación.",
  "parameters": {
    "type": "object",
    "properties": {
      "from_stage": { "type": "string", "enum": ["A","MS","B","C"] },
      "to_stage":   { "type": "string", "enum": ["MS","B","C","D"] },
      "evidence":   { "type": "string", "description": "Cita textual del mensaje del lead que justifica el avance" },
      "reason":     { "type": "string", "description": "Por qué califica para avanzar" },
      "confidence": { "type": "string", "enum": ["low","med","high"] }
    },
    "required": ["from_stage","to_stage","evidence","reason","confidence"]
  }
}
```

Validaciones API:
- `to_stage = from_stage + 1` (lineal estricto).
- `confidence` ≥ `med`.
- `evidence` no vacío.
- Inserta en `stage_transitions` (audit).

#### `request_human_handoff`
```json
{
  "name": "request_human_handoff",
  "description": "Pide intervención humana cuando se detecta frustración, complejidad fuera del pipeline, o queja.",
  "parameters": {
    "type": "object",
    "properties": {
      "reason":  { "type": "string" },
      "urgency": { "type": "string", "enum": ["low","med","high"] }
    },
    "required": ["reason","urgency"]
  }
}
```

#### `reply_text`
```json
{
  "name": "reply_text",
  "description": "Responde con texto libre cuando ningún flujo pre-armado aplica.",
  "parameters": {
    "type": "object",
    "properties": { "message": { "type": "string" } },
    "required": ["message"]
  }
}
```

---

## 8. Memoria conversacional

**Estrategia:** Resumen por etapa + últimos 10 mensajes literales.

```sql
CREATE TABLE conversation_state (
  user_id          TEXT PRIMARY KEY,
  stage_summaries  JSONB DEFAULT '{}',  -- { "A": "...", "MS": "...", "B": "..." }
  recent_messages  JSONB DEFAULT '[]',  -- últimos 10 turnos (user+assistant)
  extracted_data   JSONB DEFAULT '{}',  -- nombre, email, objeciones, etc.
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

**Mecánica:**
- Cada turno → agrega a `recent_messages`, recorta a últimos 10.
- Al ejecutar `advance_stage` exitoso → LLM auxiliar genera resumen breve de la etapa que se cierra → guarda en `stage_summaries[etapa_anterior]` → purga `recent_messages` (opcional, conservar últimos 3 como puente).
- Prompt del LLM incluye: resúmenes de etapas previas + 10 mensajes recientes + datos extraídos.

---

## 9. Handoff humano (mezcla reglas + LLM)

### 9.1 Reglas hard (evaluadas en la API antes de llamar al LLM)

- Keywords: "humano", "persona real", "asesor", "queja", "reclamo", "demanda".
- Palabras de riesgo: "refund", "legal", "abogado", "prensa".
- N=3 turnos consecutivos con `confidence: low` del LLM.
- `lost` automático al completarse 8/8 follow-ups en C.

### 9.2 Tool del LLM

`request_human_handoff` — invocado cuando el LLM detecta señales semánticas (frustración, complejidad fuera de pipeline).

### 9.3 Acción

1. API ejecuta flujo `SYS_handoff_humano` en ManyChat.
2. Notifica equipo (Slack/email).
3. Marca `lead.bot_paused = TRUE` en Postgres → mensajes futuros no van al LLM.
4. Inserta entrada en `handoff_log` con motivo y contexto.

---

## 10. Cancelación de follow-ups

Cada follow-up programado lleva en Postgres:

```sql
CREATE TABLE scheduled_followups (
  id            UUID PRIMARY KEY,
  user_id       TEXT NOT NULL,
  etapa         TEXT NOT NULL,
  flow_name     TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|sent|cancelled
  cancel_token  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_followups_pending ON scheduled_followups(user_id, etapa, status)
  WHERE status = 'pending';
```

**Reglas de cancelación:**

| Evento | Acción |
|---|---|
| Lead responde estando en B o C | Cancelar follow-ups `pending` de la etapa actual |
| `advance_stage` exitoso | Cancelar follow-ups `pending` de etapa previa |
| Handoff humano | Cancelar TODOS los follow-ups `pending` del lead |
| `lost` | Cancelar todos los `pending` |

---

## 11. Schema Postgres completo

```sql
-- Lead y estado
CREATE TABLE leads (
  user_id        TEXT PRIMARY KEY,     -- IG user id desde ManyChat
  etapa          TEXT NOT NULL DEFAULT 'A',
  bot_paused     BOOL DEFAULT FALSE,
  lost           BOOL DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Audit de transiciones
CREATE TABLE stage_transitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES leads(user_id),
  from_stage  TEXT NOT NULL,
  to_stage    TEXT NOT NULL,
  evidence    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  confidence  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Handoff log
CREATE TABLE handoff_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  trigger     TEXT NOT NULL,           -- rule:keyword|rule:low_conf|llm_tool
  reason      TEXT,
  urgency     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- (flow_registry, conversation_state, scheduled_followups: ver secciones 4.2, 8, 10)
```

---

## 12. Booking (Calendly)

- Setter manda link Calendly vía flujo `C_setter_calendly_link` (decisión del LLM).
- Calendly dispara webhook `invitee.created` → API marca `etapa = 'D'` y guarda `extracted_data.appointment` (datetime, link, etc.).
- LLM también puede detectar confirmación textual del lead → invoca `advance_stage(C → D)`.
- **Lo que ocurra primero gana.** Idempotencia: si ya está en D, ignora.

---

## 13. Flujo end-to-end (ejemplo: lead que llega a D)

```
1.  Setter ejecuta flujo A_setter_vsl manualmente (o trigger inicial)
    → ManyChat envía video + audio + VSL al lead
    → lead.etapa = 'A'

2.  Lead responde "👍 increíble"
    → ManyChat → POST /inbound → buffer Redis (20s)
    → API consolida → n8n LLM con tools de etapa A
    → LLM invoca advance_stage(A → MS, evidence="👍 increíble", confidence=high)
    → API valida, actualiza lead.etapa = 'MS', graba transition

3.  Lead pregunta "¿cuánto cuesta?"
    → buffer 20s → n8n LLM con tools de MS
    → LLM invoca advance_stage(MS → B, evidence="¿cuánto cuesta?", confidence=high)
    → lead.etapa = 'B'
    → API programa 8 follow-ups B_followup_{1..8} en scheduled_followups

4.  Conversación continúa en B (LLM usa reply_text o flujos B_*)
    Cada vez que lead responde → API cancela follow-ups pending de B

5.  LLM decide es momento de Calendly
    → invoca send_flow_c_setter_calendly_link
    → ManyChat envía link
    → API marca etapa = 'C', cancela follow-ups B, programa C_followup_{1..8}

6.  Lead agenda en Calendly
    → webhook → API marca etapa = 'D', cancela follow-ups C
    → bot sigue activo en D para confirmaciones/dudas/recordatorios
```

---

## 14. Decisiones abiertas (no bloquean implementación)

- **Mecanismo de agendamiento definitivo:** Calendly asumido. Alternativas si surgen requisitos: Cal.com (self-hosted) o Google Calendar API directa.

---

## 15. Próximos artefactos sugeridos

1. Diagrama visual end-to-end (secuencia).
2. JSON schemas completos de tools (con ejemplos).
3. Prompt sistema del LLM (incluye reglas de etapa, tono, restricciones).
4. Tests E2E por etapa.
5. Runbook de operación (cómo agregar un flujo nuevo, cómo pausar el bot, etc.).
