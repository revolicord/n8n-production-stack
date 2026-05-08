# 13 · Funnel de 5 etapas, agente y memoria

Este documento define **cómo el agente LLM gestiona el funnel de Quantum Creators**: las 5 etapas, las transiciones, los follow-ups, el handoff a humano y la integración con los flows pregrabados de ManyChat.

> Esto es la **lógica de negocio del agente**. Toda esta capa vive en **n8n + Postgres**. El código Fastify no la conoce: solo le pasa el batch al agente vía webhook y recibe el callback con la respuesta.

## Las 5 etapas

Replicadas del Excel "DM Sorcery Tracker" de Imperium, ahora gestionadas por el agente:

| Sigla | Nombre | Quién maneja | Qué pasa |
|---|---|---|---|
| **A** | Initiated | bot | Lead recibió el primer mensaje + Vídeo 1 (vídeo de enganche, 25 seg) |
| **MS** | Media Seen | bot | Lead confirmó (verbal o emoji) que vio el Vídeo 1 |
| **B** | Engaged | bot | Lead recibió Vídeo 2 (VSL, 1:58) + reaccionó con 👍 o equivalente positivo |
| **C** | Calendly'd | bot | Lead recibió el link `quantumcreators.es/llamada-de-discovery` |
| **D** | Booked | handoff a closer | Lead reservó la llamada en Calendly (closer toma desde aquí) |

Etapas terminales (no avanzan):
- **`disqualified`**: lead descalificado por el agente (no money, no quality, geographic, etc.).
- **`lost`**: 8 follow-ups agotados sin respuesta.
- **`escalated_human_call`**: tras follow-up 5 (día 7), el agente notifica a Alex para llamada por IG.

## Modelo de datos

Tablas nuevas en schema `api`. Se añaden a las del doc `03-modelo-de-datos.md`.

```sql
CREATE TABLE api.lead_stages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES api.tenants(id),
  subscriber_id       UUID NOT NULL REFERENCES api.subscribers(id),
  conversation_id     UUID NOT NULL REFERENCES api.conversations(id),
  current_stage       TEXT NOT NULL,
                      -- 'A' | 'MS' | 'B' | 'C' | 'D'
                      -- | 'disqualified' | 'lost' | 'escalated_human_call'
  entered_stage_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  disqualification_reason TEXT,
                      -- 'no_money' | 'no_quality' | 'not_interested'
                      -- | 'geographic' | 'objection_unresolved'
                      -- | 'fake_account' | NULL
  follow_up_count     INT NOT NULL DEFAULT 0,
  next_follow_up_at   TIMESTAMPTZ,
  next_follow_up_index INT,
                      -- 1..8, qué follow-up toca enviar
  closer_assigned_id  UUID REFERENCES api.closers(id),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
                      -- guarda señales detectadas, contexto del agente
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subscriber_id, conversation_id)
);
CREATE INDEX ON api.lead_stages (tenant_id, current_stage);
CREATE INDEX ON api.lead_stages (tenant_id, next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

CREATE TABLE api.stage_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  lead_stage_id   UUID NOT NULL REFERENCES api.lead_stages(id),
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  reason          TEXT,
                  -- 'agent_decision' | 'follow_up_exhausted'
                  -- | 'manual_override' | 'calendly_booked'
                  -- | 'human_called' | 'objection_detected'
  triggered_by    TEXT NOT NULL,
                  -- 'agent' | 'human:<user_id>' | 'system' | 'calendly_webhook'
  agent_evidence  TEXT,
                  -- razonamiento del LLM, si aplica
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON api.stage_transitions (tenant_id, occurred_at DESC);
CREATE INDEX ON api.stage_transitions (lead_stage_id, occurred_at);

CREATE TABLE api.closers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES api.tenants(id),
  name            TEXT NOT NULL,
  calendly_url    TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  assignment_count INT NOT NULL DEFAULT 0,
  -- contador para round-robin
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api.follow_up_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES api.tenants(id),
  applies_to_stage TEXT NOT NULL,
                  -- 'A' | 'MS' | 'B' | 'C' (no D ni escalated)
  follow_up_index INT NOT NULL,
                  -- 1..8
  delay_after_entry_hours INT NOT NULL,
                  -- horas desde entered_stage_at o último follow-up
  message_type    TEXT NOT NULL,
                  -- 'text' | 'audio' | 'sticker' | 'meme'
  text_content    TEXT,
  flow_ns_to_trigger TEXT,
                  -- si message_type != text, qué flow de ManyChat disparar
  active          BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, applies_to_stage, follow_up_index)
);

CREATE TABLE api.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  type            TEXT NOT NULL,
                  -- 'human_call_required' | 'lead_booked'
                  -- | 'objection_unresolved' | 'agent_uncertain'
  subscriber_id   UUID,
  lead_stage_id   UUID,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  payload         JSONB DEFAULT '{}'::jsonb,
  seen_at         TIMESTAMPTZ,
  seen_by         TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON api.notifications (tenant_id, seen_at NULLS FIRST, created_at DESC);
```

## Las dos formas en que el agente actúa por turno

Cada vez que el debounce dispara un batch al agente (vía webhook a n8n), el agente hace **dos cosas**:

1. **Decide qué responder al usuario** (texto, audio, video, sticker, link).
2. **Decide si la etapa cambia** y lo registra en `lead_stages` + `stage_transitions`.

Ambas decisiones las toma con base en:
- El batch de mensajes del usuario (lo que acaba de escribir).
- La memoria conversacional (historial completo).
- La etapa actual del lead.
- El system prompt del agente para esa etapa.

## Memoria conversacional

Tres niveles, ya parcialmente diseñados en docs anteriores:

| Nivel | Dónde vive | Qué guarda | TTL |
|---|---|---|---|
| **Caliente** | Redis `mem:{tenant}:{subscriber}` | Últimos N=20 turnos comprimidos | 12h |
| **Cálido** | Postgres `turns.batch_text` + `turns.response_text` | Histórico completo de turnos | 12 meses |
| **Frío** | Postgres `conversations.summary` | Resumen narrativo del lead | indefinido |

n8n al hidratar memoria al inicio del workflow:

1. Lee `mem:{tenant}:{subscriber}` de Redis. Si tiene contenido → usa eso.
2. Si Redis está vacío (lead que vuelve tras 12h+), carga de Postgres los últimos 10 turnos + summary.
3. Tras procesar el turno, escribe el nuevo turno a Redis (push + trim a N=20).

El **summary** se actualiza cada 5 turnos por un sub-workflow de n8n que llama al LLM con prompt "resume esta conversación en 3-4 frases factuales".

## Tools disponibles para el agente

El agente en n8n tiene este conjunto de tools (definidas como nodos del AI Agent o como sub-workflows):

### Tools de envío

| Tool | Cuándo usarla | Implementación |
|---|---|---|
| `send_text(text)` | Respuesta libre del agente | n8n llama a ManyChat API `/sending/sendContent` con texto |
| `send_video_hook()` | Etapa A: enviar Vídeo 1 (25 seg) | Dispara flow `video_hook` de ManyChat |
| `send_video_vsl()` | Etapa MS→B: enviar VSL (1:58) | Dispara flow `video_vsl` |
| `send_audio(audio_id)` | Audios pregrabados (preguntar si vio video, agradecimientos, etc.) | Dispara flow correspondiente; lista en `tenants.config.flows` |
| `send_sticker(sticker_id)` | Reacción visual rápida | Dispara flow correspondiente |
| `send_calendly_link()` | Etapa B→C: enviar link de agendamiento | Selecciona closer round-robin + `send_text` con su URL |

### Tools de estado del lead

| Tool | Cuándo usarla |
|---|---|
| `set_stage(new_stage, reason, evidence)` | Avanzar/cambiar etapa del lead |
| `mark_disqualified(reason)` | Descartar lead (`no_money`, `no_quality`, `not_interested`, `geographic`, `fake_account`) |
| `schedule_follow_up(index, delay_hours)` | Programar próximo follow-up tras silencio |
| `cancel_follow_ups()` | Cancelar follow-ups pendientes (lead respondió o avanzó) |
| `notify_human(type, title, body)` | Crear notificación para Alex en el dashboard |

### Tools de lectura

| Tool | Para qué |
|---|---|
| `get_lead_state()` | Devuelve etapa actual, follow-ups previos, señales detectadas |
| `get_conversation_summary()` | Devuelve summary narrativo del lead |
| `get_objection_bank()` | Devuelve textos del banco de objeciones (poblado por Alex en Postgres) |

Cada tool es un nodo HTTP en n8n que llama a un endpoint de Fastify. Por ejemplo:

```
send_video_hook  →  POST {api}/admin/lead/{lead_id}/send-flow
                    body: { flow_name: "video_hook" }
                    
                    Fastify:
                    1. Resuelve flow_ns desde tenants.config.flows
                    2. Llama a ManyChat API para disparar el flow
                    3. Persiste el envío en messages_raw (direction='out')
                    4. Devuelve 200 con flow_ns y manychat_response_id
```

## El system prompt por etapa

Aproximación: **un único agente con system prompt extendido que conoce las 5 etapas**, en lugar de 5 sub-agentes. Razones:
- El agente puede transicionar fluidamente entre etapas en un mismo turno.
- Más fácil de iterar (un único prompt vs cinco).
- LLMs modernos (GPT-4o, Claude 3.5+) lo manejan bien con prompt bien estructurado.

Estructura del system prompt:

```
# Eres el setter de Alex Díaz Montilla en Quantum Creators.

## Tu personalidad
- Tuteas siempre, español de España.
- Tono directo, cercano, sin formalidades innecesarias.
- Frases cortas. Como mensaje de Instagram, no como email.
- Usas algún emoji ocasional (sin abusar).
- NUNCA dices el precio. NUNCA prometes resultados específicos.
- NUNCA reveles que eres un bot. Eres "Alex".

## El producto
Quantum Creators ayuda a [...]. Programa de [...]. La llamada es de descubrimiento.

## El funnel de 5 etapas
[...descripción de las 5 etapas con criterios de transición...]

## Las herramientas que tienes
[lista con descripción de cuándo usar cada tool]

## Cómo decides el siguiente paso

1. Lee el contexto: etapa actual, historial, señales previas.
2. Lee lo que acaba de escribir el lead.
3. Decide:
   a. ¿Hay objeción a manejar? → consulta banco con get_objection_bank, responde
   b. ¿Hay señal de descalificación? → mark_disqualified
   c. ¿Es momento de avanzar etapa? → set_stage + envío de contenido apropiado
   d. ¿El lead pide algo concreto? → respóndele
   e. ¿Lead silencioso? → schedule_follow_up

## Criterios de transición
- A → MS: el lead confirma haber visto el Vídeo 1 (verbal: "ya lo vi", "interesante", "vale" tras pregunta de Alex; o emoji 👍 / ✅ tras pregunta).
- MS → B: tras enviar Vídeo 2 (VSL), el lead reacciona positivamente (👍 explícito, "me encanta", "quiero saber más", "cómo funciona").
- B → C: tras un mensaje positivo claro, le envías el link de Calendly.
- C → D: lo dispara Calendly (no tú).

## Criterios de descalificación inmediata
- "no tengo dinero", "no me lo puedo permitir", "estoy sin trabajo" → no_money
- Cuenta < 100 followers Y sin foto Y inactiva → fake_account / no_quality
- "no me interesa", "no quiero", "déjame en paz" → not_interested
- País fuera de [hispanohablantes] → geographic
- Pregunta por precio antes de etapa B → responde "es lo que vamos a ver en la llamada de discovery, primero asegúrate de que encajamos"

## Cuándo escalar a humano
- Tras follow-up 5 (día 7 sin avance) → notify_human(type="human_call_required")
- Objeción que no puedes rebatir tras 2 intentos → notify_human(type="objection_unresolved")
- Lead amenaza, queja grave, situación delicada → notify_human inmediato

## Formato de respuesta
Devuelves SIEMPRE JSON estructurado con:
- actions: lista de tools a ejecutar en orden
- response_to_user: texto del mensaje (puede ser null si solo disparas videos/audios)
- stage_change: { to_stage, reason, evidence } o null
- internal_notes: notas para ti mismo en futuros turnos (se guardan en metadata)
```

Este prompt vivirá en `tenants.config.system_prompt` o en un archivo del repo (`/n8n/prompts/setter-v1.md`) versionado. **No vive en código TypeScript**.

## Flujo end-to-end con ejemplo concreto

### Ejemplo 1: Lead nuevo entra por Default Reply

```
T+0   Usuario manda DM: "hola"
       → Webhook a Fastify
       → Debounce 8s
       
T+8s  Agente recibe batch de 1 mensaje. Estado: lead nuevo, sin etapa.
       Agente decide:
       1. set_stage("A", "first_contact", "lead inició conversación")
       2. send_text("Eyy! Qué tal? Te paso un vídeo rápido para que veas
                    de qué va Quantum Creators 👇")
       3. send_video_hook()
       4. schedule_follow_up(1, 24)
       → n8n ejecuta los 4 → callback a Fastify
       → lead_stages: { current_stage: 'A', next_follow_up_at: T+24h, follow_up_index: 1 }
       
T+5min Usuario manda: "ah genial, lo veo y te digo"
       → Debounce 8s, agente recibe.
       Agente decide:
       1. cancel_follow_ups()  (lead respondió, ya no hace falta el FU#1 a 24h)
       2. send_text("Perfecto, tómate tu tiempo. Cuando lo veas avísame ✌️")
       3. schedule_follow_up(1, 36)  (replanifica para 36h porque dijo que lo verá)
       
T+18h Usuario manda: "ya lo vi, interesante"
       → Agente recibe.
       Agente decide:
       1. set_stage("MS", "user_confirmed_seeing_video", "user dijo 'ya lo vi'")
       2. cancel_follow_ups()
       3. send_text("Genial! Te paso un segundo vídeo más completo donde
                    te explico todo el sistema. Dura 2 minutos 🎯")
       4. send_video_vsl()
       5. schedule_follow_up(1, 24)
       
T+19h Usuario manda: "👍 me encanta"
       → Agente recibe.
       Agente decide:
       1. set_stage("B", "vsl_engaged", "user reacted positively to VSL")
       2. cancel_follow_ups()
       3. send_text("Brutal! Si te encaja, podemos hacer una llamada
                    rápida de 20min. Dame un hueco aquí 👇")
       4. send_calendly_link()  (selecciona Santi vía round-robin)
       5. set_stage("C", "calendly_sent", "link sent to Santi")
       6. schedule_follow_up(1, 24)
       
T+22h Calendly webhook → POST a Fastify /webhook/calendly
       → Fastify actualiza lead_stages a 'D'
       → Notification: "Lead booked: @ingenieroenia con Santi a las 11h del martes"
       → cancel_follow_ups()
```

### Ejemplo 2: Lead con objeción de dinero

```
Usuario (en etapa MS): "el precio es muy alto pa mi"
Agente:
1. internal_note: "objeción de dinero detectada en MS"
2. send_text("Entiendo. Antes de hablar de precio, ¿has visto el segundo
              vídeo donde explico cómo funciona? Quizás cambia tu visión.")
3. send_video_vsl()
   (intenta seguir el flujo en lugar de descalificar inmediato)

Usuario más tarde: "ya lo vi pero igual no me llega"
Agente:
1. mark_disqualified("no_money")
2. send_text("Te entiendo perfectamente. Dejo aquí la puerta abierta
              para cuando sea tu momento. Mucho éxito ✌️")
3. set_stage("disqualified", "no_money", "user confirmed financial barrier after VSL")
```

### Ejemplo 3: Escalation a humano por silencio prolongado

```
T+0     Lead en etapa B, last activity hace 7 días, follow-up 5 enviado.
T+7d    Cron en n8n consulta: SELECT * FROM lead_stages
                              WHERE next_follow_up_at < now()
                              AND current_stage IN ('A','MS','B','C')
                              AND follow_up_count >= 5;
        Para cada uno:
        - set_stage("escalated_human_call", "follow_up_exhausted")
        - notify_human(
            type: "human_call_required",
            title: "Llamada IG: @ingenieroenia",
            body: "Lead en B, 5 follow-ups sin respuesta. Última: hace 7 días.
                   Audio recomendado: el de 'última llamada'."
          )
        - cancel_follow_ups()
        Alex ve la notificación en el dashboard, hace la llamada, marca
        seen_at + (manualmente) decide si lo descalifica o reactiva.
```

## El cron de follow-ups y escalation

Workflow programado en n8n que corre cada 5 minutos:

```
[Cron 5min]
   ↓
[Postgres: SELECT lead_stages
            WHERE next_follow_up_at <= now()
            AND current_stage IN ('A','MS','B','C')
            ORDER BY next_follow_up_at ASC LIMIT 50]
   ↓
[Loop por cada lead]
   ↓
[Decide siguiente acción según follow_up_count]:
  - count < 5  → enviar follow_up_template[follow_up_count + 1]
                 + incrementar count + reschedule
  - count >= 5 → escalation a humano (set_stage + notification)
   ↓
[Postgres: UPDATE lead_stages]
```

Las plantillas de follow-up son seedeadas al inicio (Sprint 2) con textos genéricos. Alex luego las edita en el dashboard.

Ejemplo de seed (cadencia días 1, 2, 3, 5, 7, 9, 11, 13):

```sql
INSERT INTO api.follow_up_templates (tenant_id, applies_to_stage, follow_up_index, delay_after_entry_hours, message_type, text_content) VALUES
('<quantum-id>', 'A', 1, 24,  'text', 'Hey, ¿pudiste ver el vídeo? 👀'),
('<quantum-id>', 'A', 2, 48,  'text', 'Te lo dejo por aquí de nuevo por si acaso'),
('<quantum-id>', 'A', 3, 72,  'audio', NULL),  -- audio "qué te pareció"
('<quantum-id>', 'A', 4, 120, 'meme',  NULL),  -- meme/sticker
('<quantum-id>', 'A', 5, 168, 'text', 'Veo que has estado liado, te llamo yo mejor'),
-- ...
```

Alex sustituye los textos cuando arranque el sistema y vea cómo van los reales.

## Round-robin de closers

Tabla `closers` con `assignment_count`. La tool `send_calendly_link` ejecuta:

```sql
SELECT * FROM api.closers
WHERE tenant_id = $1 AND active = true
ORDER BY assignment_count ASC, random()
LIMIT 1
FOR UPDATE;

-- Tras seleccionar:
UPDATE api.closers
SET assignment_count = assignment_count + 1
WHERE id = $selected;
```

Para el MVP: simple y suficiente. En futuro: peso por ocupación de calendario, especialidad por tipo de lead, etc.

## Detección de "Media Seen" — la heurística adaptativa

Como dijiste: "interactuar siempre cuando el cliente está bien caliente y presente". El agente decide enviar la pregunta "¿pudiste ver el vídeo?" basándose en señales de **presencia**:

```
Señal positiva (preguntar ya):
- last_seen < 15 min
- usuario escribió cualquier cosa hace < 5 min
- el usuario reaccionó al vídeo dentro de los 5 min de envío

Señal neutra (esperar pero programar):
- last_seen < 24h
- → schedule_follow_up con delay 6h + chequear presencia antes de enviar

Señal negativa (esperar follow-up programado):
- last_seen > 24h
- → seguir cadencia normal de follow-ups
```

Esta lógica vive en el system prompt del agente: el agente recibe `instagram_context.last_seen` y `last_interaction` en cada batch, y decide cuándo es el momento de preguntar.

## Tabla de flows de ManyChat necesarios

Configurar en `tenants.config.flows` JSON. Antes del MVP, Alex debe asegurarse de que existen estos flows en su cuenta de ManyChat (están como STOPPED ahora, hay que activarlos):

| Flow ManyChat | flow_name (semántico) | Contenido | Disparado por |
|---|---|---|---|
| Envio de videos (Vídeo 1) | `video_hook` | Vídeo de 25 seg | Etapa A |
| Envio de videos (Vídeo 2) | `video_vsl` | VSL de 1:58 | Etapa MS→B |
| Envio de audios (intro VSL) | `audio_vsl_intro` | Audio que acompaña al Vídeo 2 | Junto con `video_vsl` |
| Envio de audios (¿viste?) | `audio_did_you_see_video` | "¿Pudiste verlo? Cuéntame qué te pareció" | Tras Vídeo 1 |
| Envio de audios (gracias) | `audio_thanks_engaged` | Audio agradeciendo el 👍 | Tras detectar engagement |
| Envio de stickers (varios) | `sticker_<nombre>` | Stickers reactivos | Reacciones rápidas |
| Envio de mensajes (FU memes) | `meme_followup_4`, `meme_followup_6` | Memes para follow-ups 4 y 6 | Cron de follow-ups |

Alex configura cada flow una vez, anota su `flow_ns` (visible en URL del editor de ManyChat o vía API), y actualiza `tenants.config.flows`.

## Frontera código vs n8n para el funnel

Reafirmamos la regla del doc 02 con ejemplos concretos del funnel:

| Lógica | Vive en | Por qué |
|---|---|---|
| Avanzar etapa | n8n (agente decide) + Fastify (persiste) | Decisión = LLM. Persistencia = código. |
| Descalificar | Igual | |
| Programar follow-up | Igual (agent decide cuándo, Fastify guarda en DB) | |
| Cron de follow-ups | n8n workflow | Trigger temporal, queries SQL, fácil de iterar |
| Round-robin de closers | Fastify endpoint | Operación de mutación atómica con lock |
| Notificación a Alex | Fastify endpoint | Crea fila en `notifications`, dashboard la muestra |
| Marcar notification como vista | Fastify endpoint | El dashboard llama a `POST /admin/notifications/:id/seen` |
| Calendly webhook | Fastify endpoint dedicado | Verifica firma, actualiza lead a D, dispara notificación |
| System prompt del agente | n8n credentials o repo `/n8n/prompts/` | Iterable sin redeploy |
| Templates de follow-up | Postgres `follow_up_templates` (editable desde dashboard) | Alex los cambia sin tocar n8n |
| Banco de objeciones | Postgres `objection_bank` (futuro) | Iterable, agente lo consulta como tool |

## Antipatrones específicos del funnel

❌ **Hardcodear las etapas en código**. Vive en `lead_stages.current_stage` como TEXT con CHECK constraint, no como enum tipado en TS. Permite añadir etapas sin migración.

❌ **Que el agente decida etapas sin razonamiento**. Cada `set_stage` debe llevar `evidence` (la frase del usuario que lo justifica). Necesario para auditar y mejorar el prompt.

❌ **Saltar etapas**. El agente NO puede ir de A → C directamente. Si lo intenta, Fastify rechaza con 400 y el agente reintenta. Las transiciones válidas están en una constante.

❌ **Descalificar a la primera objeción**. El prompt instruye dos intentos antes de descalificar. Métricas: `objections_resolved` vs `objections_to_disqualified`.

❌ **Mandar follow-up sin chequear presencia**. El agente no manda follow-ups en madrugada del lead (heurística adaptativa).

❌ **Mezclar follow-ups del cron con respuestas en vivo**. Si el lead responde justo cuando el cron iba a mandar follow-up, hay que cancelar el follow-up. La tool `cancel_follow_ups()` lo hace; el agente la invoca cada vez que recibe mensaje del usuario.

## Métricas que esto habilita

Por consulta SQL en Grafana / dashboard (detalle en doc 14):

```sql
-- MSR: Media Seen Rate
SELECT
  count(*) FILTER (WHERE current_stage IN ('MS','B','C','D')) * 1.0 /
  NULLIF(count(*) FILTER (WHERE current_stage IN ('A','MS','B','C','D')), 0) AS msr
FROM api.lead_stages
WHERE tenant_id = $1 AND entered_stage_at >= date_trunc('month', now());

-- PRR: Engagement Rate (B sobre A)
SELECT
  count(*) FILTER (WHERE current_stage IN ('B','C','D')) * 1.0 /
  NULLIF(count(*) FILTER (WHERE current_stage IN ('A','MS','B','C','D')), 0) AS prr
FROM api.lead_stages
WHERE tenant_id = $1 AND entered_stage_at >= date_trunc('month', now());

-- CSR
SELECT
  count(*) FILTER (WHERE current_stage IN ('C','D')) * 1.0 /
  NULLIF(count(*) FILTER (WHERE current_stage IN ('A','MS','B','C','D')), 0) AS csr
FROM api.lead_stages
WHERE tenant_id = $1 AND entered_stage_at >= date_trunc('month', now());

-- ABR
SELECT
  count(*) FILTER (WHERE current_stage = 'D') * 1.0 /
  NULLIF(count(*) FILTER (WHERE current_stage IN ('A','MS','B','C','D')), 0) AS abr
FROM api.lead_stages
WHERE tenant_id = $1 AND entered_stage_at >= date_trunc('month', now());

-- Tasas de transición
SELECT
  to_stage,
  count(*) AS transitions,
  count(DISTINCT lead_stage_id) AS unique_leads
FROM api.stage_transitions
WHERE tenant_id = $1 AND occurred_at >= date_trunc('month', now())
GROUP BY to_stage;
```

Detalles del dashboard en doc 14.
