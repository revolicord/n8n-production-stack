# Design: Agente WhatsApp para Clínicas Dentales

**Fecha:** 2026-06-22  
**Estado:** Aprobado — listo para plan de implementación  
**Autor:** Revolicord / Claude Code  
**Filosofía base:** RASA CALM sobre LangGraph.js, determinismo máximo, evolución guiada por producción

---

## 1. Contexto y objetivo

Producto nuevo e independiente (repo separado) que toma la filosofía y stack del repo `n8n-production-stack` y lo orienta al canal WhatsApp para clínicas dentales.

**El médico paga mensualidades cuando:**
- El agente agenda citas solo, sin recepcionista
- Responde en 8 segundos a cualquier hora
- Se siente humano (mensajes cortos, en secuencia, con pausas)
- El dashboard muestra cuánto le está rindiendo

**Lo que este producto resuelve que el repo actual no tiene:**
- Canal WhatsApp (vs Instagram DM)
- Modelo semántico explícito: Speech Acts + DST + discourse structure
- Ontología evolutiva con active learning
- RAG sobre conocimiento del negocio (pgvector)
- Audio bidireccional (STT + TTS)
- Agendamiento via Google Calendar con routing por doctor
- Dashboard orientado a métricas de negocio dental y rentabilidad del operador

---

## 2. Stack de infraestructura

Idéntico al repo base. Docker Swarm.

| Servicio | Imagen | Rol |
|---|---|---|
| `api` | `wha-api:local` | Fastify: webhook ManyChat/WA, debounce Lua, idempotency |
| `api-worker` | `wha-api:local` | BullMQ worker: drain buffer → lock → dispatch agent |
| `dashboard` | `wha-dashboard:local` | Next.js 15: métricas negocio + ontología + RAG admin |
| `postgres` | `postgres:16-alpine` + pgvector | DB principal + embeddings RAG |
| `redis` | `redis:7-alpine` | Debounce, turn locks, BullMQ queues |
| `minio` | `minio/minio` | Audios, fotos, PDFs de WhatsApp |
| `n8n` | `n8nio/n8n` | Automatizaciones opcionales (recordatorios, reportes) |
| Traefik | v2.11 | Routing: `api.`, `dashboard.`, `minio.` |

**Monorepo pnpm:**
```
apps/
  api/        Fastify + BullMQ
  agent/      LangGraph.js — pipeline NLU→DST→Policy→NLG
  dashboard/  Next.js 15
packages/
  db/         Drizzle + pgvector
  shared/     Zod schemas
```

---

## 3. Flujo de un mensaje

```
WhatsApp → ManyChat → POST /webhook/manychat
  → auth token + SHA-256 idempotency (Redis SET NX)
  → upsert subscriber + persist raw message
  → Lua debounce: buffer Redis + reset timer (15s)
  → BullMQ job

BullMQ worker:
  → token check + acquire turn lock
  → drain buffer (todos los mensajes del turno)
  → create turn record

  → dispatchToAgent() → pipeline LangGraph:

      [NLU]    LLM call estructurado (Claude, ~800-1200 tokens)
               Input: mensajes + ontología activa (cacheada) + belief state actual
               Output: { speechActs[], intents[], entities[], unknownSpans[] }

      [DST]    Código TypeScript puro — 0 tokens
               Merge slots → belief_state
               Detecta: CorrectionPattern, AbandonPattern
               Registra unknownSpans → ontology_suggestions
               Actualiza discourse_segments[]

      [Policy] CALM flow engine — 0 tokens
               Evalúa belief_state + flows del tenant (Postgres)
               Emite: AskSlot | ConfirmBooking | ExecuteTool |
                      SendInfo | ClarifyIntent | HumanHandoff

      [NLG]    LLM call SOLO si Policy no resuelve con template
               Output: texto corto, human-like, en español dental

      [MessageSplitter]   0 tokens, código determinista
               Divide output en array [{ text, delay_ms }]
               Delay ∝ longitud del mensaje anterior (35ms/char)
               → BullMQ jobs secuenciales con delay acumulado

  → ManyChat API → WhatsApp → paciente
  → saveTurnTrace + turn_costs
  → release turn lock
```

---

## 4. Pipeline de audio bidireccional

**Recepción (STT):**
```
audio message → descarga → MinIO (preservación)
  → BullMQ STT job (no bloquea debounce)
  → OpenAI Whisper API ($0.006/min)
  → transcript entra al pipeline NLU como texto normal
  → turn_trace guarda { source: 'audio', transcript, duration_s }
```

**Emisión (TTS) — opcional por tenant:**
```
Policy emite respuesta + condiciones:
  tenant.config.tts_enabled = true
  AND discourse_depth > 2
  AND último mensaje fue audio (reciprocidad de canal)
  → NLG text → OpenAI TTS ($15/1M chars)
  → MP3 → MinIO → URL presignada
  → ManyChat sendContent audio
```

**MinIO buckets por tenant:**
```
{tenant_id}/audio/inbound/     audio WA originales
{tenant_id}/audio/outbound/    respuestas TTS generadas
{tenant_id}/images/            fotos / radiografías
{tenant_id}/documents/         PDFs presupuestos, consentimientos
{tenant_id}/rag/               docs RAG del negocio
```

---

## 5. Modelo semántico (NLU + DST)

### Taxonomía de actos del habla (fija, no editable por tenant)

| Código | Descripción | Ejemplo |
|---|---|---|
| REQUEST | Solicitud de acción | "quiero una cita" |
| INFORM | Entrega de información | "soy paciente nuevo" |
| CONFIRM | Afirmación | "sí, perfecto" |
| DENY | Negación | "no puedo ese día" |
| GREET | Saludo | "hola buenas tardes" |
| FAREWELL | Despedida | "gracias, hasta luego" |
| COMPLAIN | Queja | "llevan mucho sin contestar" |
| NEGOTIATE | Renegociación | "¿y si voy más tarde?" |
| CLARIFY | Corrección/aclaración | "me refiero a la limpieza" |
| ACKNOWLEDGE | Reconocimiento | "ok, entendido" |
| ESCALATE | Solicitud de humano | "quiero hablar con alguien" |

### Intenciones base dental (extendibles por tenant)

```
agendar_cita / reagendar_cita / cancelar_cita
consulta_precio / consulta_disponibilidad
info_tratamiento / info_ubicacion / info_horarios
confirmar_seguro / confirmar_datos_paciente
urgencia_dental / saludo / despedida / fuera_de_scope
```

### Entidades clave

```
servicio_dental    enum: limpieza | ortodoncia | extracción | blanqueamiento | endodoncia | ...
doctor_preferido   FK a clinic_doctors.id
fecha_preferida    date_expression: ISO 8601 | "mañana" | "próxima semana"
hora_preferida     enum: mañana | tarde | noche | HH:MM
nombre_paciente    string
es_paciente_nuevo  boolean
seguro_medico      string | "no tengo"
motivo_urgencia    enum: dolor | accidente | seguimiento
```

### Dialogue State Tracking (DST)

Estado persistido en `dialogue_states.belief_state`:
```json
{
  "slots": {
    "servicio_dental": { "value": "limpieza", "confidence": 0.95, "turn_filled": 2 },
    "doctor_id": { "value": null, "confidence": null },
    "fecha_preferida": { "value": "2026-06-30", "confidence": 0.88, "turn_filled": 3 }
  },
  "patterns_fired": ["CorrectionPattern"],
  "discourse_depth": 4,
  "active_flow": "flow_agendar_cita",
  "current_step": 4
}
```

### Active learning loop

```
DST detecta unknownSpan
  → INSERT ontology_suggestions (span, context, frequency++)
  → Dashboard operador: "este span apareció 12 veces"
  → Operador etiqueta como intent/entity
  → Agrega a ontology_intents/entities sin deploy
```

---

## 6. CALM flows dental

### Flows core

```
flow_agendar_cita         8-10 pasos, happy path 0 tokens NLG
flow_reagendar_cita       reutiliza slots, pide nueva fecha
flow_cancelar_cita        confirma + libera slot Calendar
flow_verificar_cita       consulta cita existente
flow_info_servicio        RAG search + respuesta informativa
flow_urgencia_dental      motivo + HumanHandoff inmediato
flow_fuera_scope          ClarifyIntent o HumanHandoff
pattern_correction        slot sobreescrito → confirmar nuevo valor
pattern_human_handoff     escalación + pausa agente
pattern_cannot_handle     audio ininteligible, idioma no soportado
```

### flow_agendar_cita — pasos

```yaml
1. collect: servicio_dental
   ask: "¿Qué tratamiento necesitas? 😊"

2. branch: doctores activos con esa especialidad > 1
   yes → collect: doctor_preferido
          ask: "¿Tienes preferencia de doctor? Tenemos a {doctor_list}"
          skip_if: "cualquiera" | "no importa"
   no  → auto_assign: primer doctor activo con especialidad

3. collect: es_paciente_nuevo
   ask: "¿Es tu primera visita con nosotros?"

4. collect: fecha_preferida
   ask: "¿Qué día te viene bien?"

5. action: check_availability(doctor_id, servicio, fecha_preferida)
   found    → presentar máx 3 slots
   no_found → collect: fecha_preferida (retry)

6. collect: slot_confirmado
   (paciente elige de las opciones presentadas)

7. collect: nombre_paciente
   skip_if: subscriber.name ya conocido

8. action: create_booking(doctor_id, slot, servicio, paciente)

9. end:
   template: "✅ Listo {nombre}, tu cita está agendada:
              📅 {fecha} a las {hora}
              👨‍⚕️ {doctor}
              📍 {direccion}
              Te llegará confirmación por correo."
   task_completed: true
   emit: BookingCreated → n8n (recordatorios opcionales)
```

### Token economy por escenario

| Escenario | NLU | NLG | STT | Total aprox |
|---|---|---|---|---|
| Saludo inicial | ~800 | 0 (template) | 0 | **~800** |
| Consulta precio (RAG) | ~900 | ~500 | 0 | **~1400** |
| Agendar cita happy path (3 turnos) | ~3000 | 0 (templates) | 0 | **~3000** |
| Corrección de slot | ~900 | ~600 | 0 | **~1500** |
| Audio entrante | ~900 | 0 | ~$0.003 | **~900 + STT** |
| Escalación humana | ~800 | 0 (template) | 0 | **~800** |

---

## 7. Tools deterministas

```typescript
check_availability({ tenant_id, doctor_id?, servicio, fecha_preferida, hora_preferida? })
  → Google Calendar freebusy API
  → slots[] ordenados por proximidad a preferencia
  → si sin doctor_id: agrupa por todos los doctores con especialidad

create_booking({ tenant_id, doctor_id, slot, servicio, paciente })
  → Calendar events.insert()
  → attendees: [doctor_email, paciente_email?]
  → guarda en bookings (métricas + reagendar/cancelar)

cancel_booking({ tenant_id, booking_id, reason? })
  → Calendar events.delete()
  → bookings.status = 'cancelled'

search_knowledge({ tenant_id, query, top_k=3, content_type? })
  → embedding del query (text-embedding-3-small)
  → cosine similarity en rag_documents (pgvector)
  → devuelve chunks[] + sources[]

get_available_doctors({ tenant_id, especialidad?, fecha? })
  → DB clinic_doctors + Calendar availability check
```

### Multi-doctor routing

```
tenant.config.escalation_routing:
  urgencia_dental  → doctor.telegram_id del especialista
  fuera_horario    → coordinadora general
  tool_error       → operador Revolicord
  patient_request  → coordinadora general
```

---

## 8. MessageSplitter — humanización de respuestas

```
NLG output (string) | template (array pre-definido)
  → MessageSplitter (código TypeScript, 0 tokens)
      Reglas: separar en oraciones, máx ~120 chars/mensaje
              listas cortas = un mensaje
              delay = chars_mensaje_anterior × 35ms
  → [{ text: "Hola María! 👋", delay_ms: 0 },
     { text: "Claro, te ayudo con eso", delay_ms: 900 },
     { text: "Tenemos disponibilidad con el Dr. García:", delay_ms: 1400 },
     { text: "• Lunes 30 / 10am\n• Martes 31 / 3pm", delay_ms: 1200 },
     { text: "¿Cuál te queda mejor?", delay_ms: 800 }]
  → BullMQ jobs con delay acumulado → ManyChat API secuencial
```

---

## 9. Escalación humana + Telegram

### Triggers de escalación

```
Inmediata (keywords configurables):
  "me duele mucho", "accidente", "sangrado", "no puedo dormir"
  → HumanHandoff(reason='urgencia_dental')

Por lógica del diálogo:
  intent = 'escalate' detectado
  fuera_de_scope por N turnos seguidos
  CorrectionPattern repetido 3+ veces en mismo slot
  Google Calendar falla al crear cita

Configurada por clínica:
  tenant.config.escalation_keywords[]
  tenant.config.max_turns_before_escalation (default: 12)
  tenant.config.escalate_after_hours (boolean)
```

### Flujo

```
HumanHandoff emitido
  → interrupt() LangGraph — agente se detiene
  → subscriber.status = 'paused'
  → respuesta inmediata al paciente (template): "Un momento, te conecto con nuestro equipo 🙏"
  → BullMQ notify job → Telegram coordinador clínica

  Mensaje Telegram:
    🦷 Clínica García — Nueva conversación
    👤 María Rodríguez | 📋 Motivo: urgencia_dental
    💬 "me duele mucho una muela desde ayer"
    [últimos 3 mensajes de contexto]
    [✋ Tomar] [📅 Agendar yo] [🤖 Continuar bot]

  [✋ Tomar] → human_active, coordinador atiende en WA
              recordatorio 30min si sin actividad
  [📅 Agendar] → abre Google Calendar del doctor
                  al terminar: bot envía confirmación
  [🤖 Continuar] → resume LangGraph desde checkpoint
```

### Routing por doctor

```
clinic_doctors.telegram_id → notificación directa al doctor relevante
Si doctor no disponible → fallback a coordinadora general
```

---

## 10. RAG — base de conocimiento del negocio

```
rag_documents por tenant:
  content_type: faq | servicio | precio | politica | doctor_bio | horario
  embedding: vector(1536) — text-embedding-3-small
  language: es | en

Onboarding (Revolicord):
  Sube PDFs → chunking automático (500-800 tokens) → embedding → pgvector

Self-service (dueño clínica):
  Dashboard: pegar texto FAQ, editar precios, agregar horarios
  Cambios re-embedean automáticamente

search_knowledge invocado cuando:
  Policy emite SendInfo (consulta precio, info tratamiento, horario, ubicación)
  chunks inyectados como contexto en NLG call
```

---

## 11. Dashboard

### Vista clínica (dueño / médico)

**Métricas semanales que generan confianza:**
- Citas agendadas esta semana (↑/↓ vs semana anterior)
- % conversaciones resueltas sin intervención humana
- Tiempo promedio de respuesta del agente
- Servicios más solicitados (gráfico de barras)
- Cómo terminaron las conversaciones (booked / informed / escalated / abandoned)
- Citas por doctor
- Lista de conversaciones recientes con outcome

**Self-service configuración:**
- Doctores (nombre, especialidades, Google Calendar ID, Telegram ID)
- Servicios y precios
- Horarios de atención + excepciones
- Persona del agente (nombre, tono, idiomas)
- Mensaje fuera de horario
- Keywords de escalación urgente

### Vista operador Revolicord

**Rentabilidad por tenant:**
```
Costo total del mes     $18.42
Cobrado al cliente      $299.00
Margen bruto            $280.58 (93.8%)

Desglose:
  NLU          $11.20  61%
  NLG           $4.80  26%  ← 31% de los turnos
  STT           $1.90  10%
  TTS           $0.42   2%
  RAG           $0.10   1%

Conversaciones más caras (señal de flows a mejorar)
Costo promedio por conversación: $0.027
Turnos resueltos con template (0 NLG): 69%  ← meta: >80%
```

**Active learning:**
- Sugerencias de ontología esta semana (spans no reconocidos + frecuencia)
- Etiquetar → agrega a ontología sin deploy

**RAG admin:**
- Subir PDFs, pegar texto
- Ver documentos indexados + probar búsqueda

**Métricas técnicas:**
- NLU confidence distribution
- Policy coverage: % template vs LLM
- DST confidence por slot
- Turns con error + traza completa
- Exportar training data (JSONL, filtrable por idioma / calidad)

**Alertas de rentabilidad:**
- Conversaciones que superan $0.40 → revisar flows con alta frecuencia NLG
- Tenant con STT alto → ajustar pricing

---

## 12. Modelo de datos (Postgres)

### Tablas por grupo

**Configuración de clínica:**
```sql
tenants (id, slug, name, config jsonb, pricing_model, flat_monthly_usd,
         price_per_conv_usd, active)
clinic_doctors (id, tenant_id, name, specialties[], google_calendar_id,
                telegram_id, active, display_order)
clinic_services (id, tenant_id, name, slug, price_min, price_max,
                 duration_min, doctor_ids[], active)
clinic_schedules (id, tenant_id, day_of_week, open_time, close_time, closed)
```

**Pacientes y conversaciones:**
```sql
subscribers (id, tenant_id, external_id, phone, name, language,
             is_new_patient, preferred_doctor_id, status, metadata)
conversations (id, tenant_id, subscriber_id, status, task_completed,
               handoff_reason, outcome, started_at, ended_at)
messages (id, tenant_id, conversation_id, subscriber_id, direction,
          content_type, text, media_url, transcript, stt_seconds,
          raw_payload, created_at)
turns (id, tenant_id, conversation_id, subscriber_id, status,
       message_ids[], started_at, completed_at)
```

**Sistema de diálogo:**
```sql
ontology_speech_acts (id, code UNIQUE, description, examples[])  -- FIJA
ontology_intents (id, tenant_id, slug, description, examples[],
                  is_base, active)
ontology_entities (id, tenant_id, slug, type, allowed_values[],
                   is_base, active)
ontology_slots (id, tenant_id, flow_id, slot_key, entity_id,
                required, ask_template, validation_rule jsonb)
ontology_suggestions (id, tenant_id, span, utterance_context,
                      frequency, suggested_type, suggested_value,
                      status, first_seen, last_seen)
dialogue_flows (id, tenant_id, slug, description, trigger_intents[],
                active)
flow_steps (id, flow_id, tenant_id, step_order, type, slot_id,
            tool_name, tool_params jsonb, branch_condition jsonb,
            template_key, next_step_id)
dialogue_states (id, tenant_id, conversation_id UNIQUE, active_flow_id,
                 current_step_id, belief_state jsonb,
                 discourse_segments jsonb[], patterns_fired[],
                 discourse_depth, updated_at)
```

**Trazabilidad:**
```sql
turn_traces (id, tenant_id, turn_id, conversation_id,
             nlu_speech_acts jsonb, nlu_intents jsonb, nlu_entities jsonb,
             nlu_unknown_spans[], dst_slots_added jsonb,
             dst_slots_changed jsonb, dst_patterns_fired[],
             policy_command, policy_template_used, policy_tool_called,
             nlg_invoked, nlg_output, message_chunks jsonb[],
             audio_inbound, stt_transcript, tts_invoked,
             task_completed, human_corrected, error, created_at)

turn_costs (id, tenant_id, turn_id, conversation_id,
            nlu_input_tokens, nlu_output_tokens, nlu_cost_usd,
            nlg_input_tokens, nlg_output_tokens, nlg_cost_usd,
            stt_seconds, stt_cost_usd,
            tts_characters, tts_cost_usd,
            embedding_tokens, embedding_cost_usd,
            total_cost_usd, created_at)
```

**Bookings y RAG:**
```sql
bookings (id, tenant_id, conversation_id, subscriber_id, doctor_id,
          service_id, google_event_id, starts_at, ends_at, status, notes)

rag_documents (id, tenant_id, content, embedding vector(1536),
               content_type, source_file, language, last_searched_at)

notifications (id, tenant_id, conversation_id, subscriber_id,
               channel, recipient, message, reason, status, sent_at)
```

### Índices críticos

```sql
CREATE INDEX ON turn_costs (tenant_id, created_at);
CREATE INDEX ON conversations (tenant_id, outcome, started_at);
CREATE INDEX ON bookings (tenant_id, doctor_id, starts_at);
CREATE INDEX ON ontology_suggestions (tenant_id, status, frequency DESC);
CREATE INDEX ON rag_documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX ON dialogue_states (conversation_id);
CREATE INDEX ON turn_traces (turn_id, tenant_id);
```

### Redis — estructura de claves

```
{tenant_id}:{subscriber_id}:debounce          token debounce (TTL=15s)
{tenant_id}:{subscriber_id}:buffer            List mensajes acumulados
{tenant_id}:{subscriber_id}:lock              turn lock exclusivo
{tenant_id}:{subscriber_id}:first_msg_ts      timestamp primer msg (max-wait)
{tenant_id}:{subscriber_id}:idempotency:{hash} SET NX dedup webhooks
{tenant_id}:{subscriber_id}:audio:{msg_id}    ref job STT en proceso
{tenant_id}:{conv_id}:belief_state            DST cache (TTL=24h)
{tenant_id}:ontology                          ontología activa (TTL=5min)
{tenant_id}:rate_limit:outbound               token bucket ManyChat
```

---

## 13. Flywheel de datos para fine-tuning

Cada conversación produce datos etiquetados automáticamente:

```
turn_traces acumula:
  utterance + nlu_output (speech_act, intent, entities, slots)
  → par de entrenamiento si task_completed=true o human_corrected=true

ontology_suggestions:
  → dataset de active learning, etiquetado por operador en dashboard

Exportación:
  GET /admin/training-export?lang=es&quality=verified
  → JSONL para fine-tuning
  → anonimizado cross-tenant para modelo dental general

Roadmap:
  Mes 1-4:   ontología mínima, producción genera suggestions
  Mes 4-8:   >1000 pares etiquetados, primer fine-tune selectivo
  Mes 8+:    NLU call más barata, margen del operador sube
```

---

## 14. Principios de evolución

- **Producción manda**: nada se define antes de tiempo; el comportamiento real guía mejoras
- **Ontología vive en Postgres**: cambios sin deploy; el operador los aplica desde dashboard
- **Cada turno es una observación**: turn_traces + turn_costs son el sensor del sistema
- **Template > LLM**: cada flow mejorado = menos tokens NLG = más margen
- **Multi-tenant por defecto**: `tenant_id` en toda tabla, `{tenant_id}:` en toda clave Redis
- **Audio es ciudadano de primera clase**: STT/TTS en el pipeline principal, no un addon
