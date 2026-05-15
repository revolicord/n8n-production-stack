# Funnel Engine — Arquitectura del Sistema de Agente IA con Follow-ups

**Versión:** 2.0  
**Fecha:** 2026-05-15  
**Estado:** Diseño aprobado — pendiente de implementación

---

## Resumen

El Funnel Engine es el sistema que gestiona el ciclo de vida completo de un lead en Instagram DM: desde el primer contacto hasta el archivado. Comprende dos workflows de n8n (`agent-run` y `followup-runner`), seis tablas nuevas en PostgreSQL, y un conjunto de endpoints CRUD en la API de Revolicord.

---

## Problema que resuelve

### Estado anterior (v1)

```
Lead escribe → agent-run → AI responde
                  ↑
          FLOW_MAP hardcodeado
          en nodo JavaScript
```

**Limitaciones:**
- Etapas y flows hardcodeados en n8n → cambiar un flow = redespliegue
- Sin seguimiento de inactividad → leads silenciosos no se reactivan
- Sin historial de follow-ups → el agente es ciego a lo que pasó fuera de su turno
- Sin archivado → recursos desperdiciados en leads muertos
- Un solo tenant implícito

### Estado objetivo (v2)

```
Lead escribe                         Lead no responde X horas
     │                                        │
     ▼                                        ▼
[agent-run]                          [followup-runner]
     │                                        │
     ├─ Lee etapas y flows desde DB           ├─ Consulta lead_crons
     ├─ Lee CRM context (follow-ups)          ├─ Envía follow-up (texto o flow)
     ├─ AI tiene contexto completo            ├─ Escribe en n8n_chat_histories
     ├─ AI puede: set_stage,                  ├─ Escribe en lead_followup_log
     │            activar_flow,               └─ Avanza secuencia o archiva
     │            archive_conversation
     └─ Resetea timer en lead_crons
```

---

## Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────────┐
│  Instagram DM                                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │ webhook
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  API Revolicord (Fastify)                                       │
│  - Valida, debouncea, encola turno                              │
│  - Endpoint: POST /admin/leads/:id/stage                        │
│  - Endpoint: POST /admin/conversations/:id/archive              │
│  - Endpoints CRUD: funnel-stages, stage-flows, followup-templates│
└──────────────────────┬──────────────────────────────────────────┘
                       │ POST /webhook/agent-run
                       ▼
┌──────────────────────────────────────────┐
│  n8n: workflow agent-run                 │
│                                          │
│  Webhook                                 │
│    └─ [PG] Get Stage Config              │◄─── funnel_stages + stage_flows
│         └─ [PG] Get CRM Context         │◄─── lead_crons + lead_followup_log
│              └─ Build Context (JS)       │
│                   └─ AI Agent            │
│                        ├─ activar_flow   │──► ManyChat API
│                        ├─ set_stage      │──► Revolicord API → subscribers
│                        └─ archive_conv.  │──► Revolicord API → lead_crons
│                   └─ enviar texto        │──► ManyChat API
│                        └─ [PG] Upsert   │──► lead_crons (reset timer)
│                             Lead Cron   │
│                              └─ [PG]    │──► lead_followup_log (mark responded)
│                                  └─ Callback ──► Revolicord API
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  n8n: workflow followup-runner           │
│                                          │
│  Schedule Trigger (cada 5 min)           │
│    └─ [PG] Get Due Leads                 │◄─── lead_crons WHERE next_followup_at <= NOW()
│         └─ Split in Batches             │
│              └─ IF: ¿hay template?      │
│                   ├─ SÍ:               │
│                   │   └─ Enviar (HTTP) │──► ManyChat API
│                   │       └─ [PG] Log  │──► lead_followup_log
│                   │           └─ [PG]  │──► n8n_chat_histories (ADR-0012)
│                   │               └─ [PG] Update lead_crons
│                   └─ NO: Archivar      │──► lead_crons (is_active=FALSE)
└──────────────────────────────────────────┘
```

---

## Schema de base de datos completo

### Tablas nuevas

```sql
-- ─── FUNNEL STAGES ──────────────────────────────────────────────────────────
CREATE TABLE funnel_stages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  slug          TEXT        NOT NULL,
  display_name  TEXT        NOT NULL,
  position      INT         NOT NULL,
  description   TEXT,
  max_followups INT         DEFAULT 3,
  is_active     BOOL        DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- ─── STAGE FLOWS ────────────────────────────────────────────────────────────
CREATE TABLE stage_flows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id    UUID        NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL,
  flow_ns     TEXT        NOT NULL,
  description TEXT,
  weight      INT         DEFAULT 1,
  is_active   BOOL        DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FOLLOWUP TEMPLATES ─────────────────────────────────────────────────────
CREATE TABLE followup_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id        UUID NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  sequence_number INT  NOT NULL CHECK (sequence_number >= 1),
  delay_hours     INT  NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('text', 'flow')),
  text_template   TEXT,
  flow_ns         TEXT,
  description     TEXT,
  is_active       BOOL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stage_id, sequence_number)
);

-- ─── LEAD FOLLOWUP LOG ──────────────────────────────────────────────────────
CREATE TABLE lead_followup_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  subscriber_id   UUID NOT NULL,
  conversation_id UUID NOT NULL,
  stage_id        UUID REFERENCES funnel_stages(id),
  template_id     UUID REFERENCES followup_templates(id),
  sequence_number INT  NOT NULL,
  text_sent       TEXT,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  status          TEXT DEFAULT 'sent' CHECK (status IN ('sent','failed','responded','skipped')),
  responded_at    TIMESTAMPTZ
);

-- ─── LEAD CRONS ─────────────────────────────────────────────────────────────
CREATE TABLE lead_crons (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL,
  subscriber_id        UUID        NOT NULL,
  conversation_id      UUID        NOT NULL,
  current_stage_id     UUID        REFERENCES funnel_stages(id),
  next_followup_at     TIMESTAMPTZ,
  next_sequence_number INT         DEFAULT 1,
  is_active            BOOL        DEFAULT TRUE,
  archived_at          TIMESTAMPTZ,
  archive_reason       TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, subscriber_id, conversation_id)
);

CREATE INDEX idx_lead_crons_due
  ON lead_crons(next_followup_at)
  WHERE is_active = TRUE AND next_followup_at IS NOT NULL;

-- ─── MIGRACIÓN subscribers ──────────────────────────────────────────────────
ALTER TABLE subscribers
  ADD COLUMN current_stage_id UUID REFERENCES funnel_stages(id);
```

### Relaciones entre tablas

```
tenants
  └── funnel_stages (tenant_id)
        ├── stage_flows (stage_id)
        └── followup_templates (stage_id)
              └── lead_followup_log (template_id)

subscribers (current_stage_id → funnel_stages)
  └── lead_crons (subscriber_id)
        └── lead_followup_log (subscriber_id + conversation_id)

n8n_chat_histories (session_id = manychat_subscriber_id)
  ← escrito por agent-run (turnos del AI)
  ← escrito por followup-runner (follow-ups automáticos)
```

---

## Flujo de datos por escenario

### Escenario 1: Primer contacto

```
1. Lead escribe "Hola"
2. agent-run:
   a. Get Stage Config → etapa 'nuevo', flows: [4 variantes con weight=1]
   b. Get CRM Context → sin datos (primera vez)
   c. Build Context → selecciona flow por peso, bloque CRM: "Es el primer contacto"
   d. AI responde + activa flow del video de enganche
   e. Upsert Lead Cron → next_followup_at = NOW() + 24h, sequence = 1
3. Lead tiene 24h para responder antes del primer follow-up
```

### Escenario 2: Lead silencioso (happy path del runner)

```
1. 24h sin respuesta → followup-runner dispara
2. Envía follow-up #1: "Oye {{name}}, ¿pudiste ver el video?"
3. Escribe en n8n_chat_histories: "[SEGUIMIENTO AUTOMÁTICO #1] Oye Carlos..."
4. Escribe en lead_followup_log: seq=1, status='sent'
5. Update lead_crons: next_followup_at = NOW() + 48h, sequence = 2

6. 48h sin respuesta → follow-up #2
7. (igual al paso 2–5 con seq=2)

8. 72h sin respuesta → follow-up #3 (último)
9. Update lead_crons: is_active=FALSE, archive_reason='max_followups'
```

### Escenario 3: Lead responde después de follow-ups

```
1. Lead responde "perdona estaba ocupado"
2. agent-run:
   a. Get CRM Context → followups_sent=2, history=[#1 hace 3d, #2 hace 1d]
   b. Memoria → ve "[SEGUIMIENTO AUTOMÁTICO #1]" y "[SEGUIMIENTO AUTOMÁTICO #2]"
   c. Build Context → bloque CRM: "2 de 3 seguimientos enviados. Está respondiendo tras silencio."
   d. AI tiene contexto completo → responde cálido, sabe que no es primer contacto
   e. Upsert Lead Cron → RESET: sequence=1, next_followup_at=NOW()+24h
   f. Update lead_followup_log → status='responded' para los pendientes
```

### Escenario 4: Agente decide cambiar de etapa

```
1. Lead: "sí quiero saber más del sistema"
2. AI detecta señal de interés → llama set_stage(new_stage='interesado')
3. Revolicord API actualiza subscribers.current_stage_id + stage_transitions
4. Upsert Lead Cron → lee current_stage_id fresco desde DB (ya es 'interesado')
                    → next_followup_at = NOW() + delay del template #1 de 'interesado'
5. Si lead responde sin cambio de etapa: timer se resetea
6. Si lead deja de responder: runner usa templates de 'interesado'
```

### Escenario 5: Agente decide archivar

```
1. Lead en límite de follow-ups responde "no me interesa"
2. Bloque CRM: "⚠️ Límite alcanzado. Si no hay interés, usa archive_conversation."
3. AI llama archive_conversation(reason="El lead indicó explícitamente que no tiene interés")
4. Revolicord API: UPDATE lead_crons SET is_active=FALSE, archive_reason='agent_decision'
5. El runner nunca más toca este lead (is_active=FALSE)
```

---

## Modificaciones al workflow `agent-run`

### Cadena de nodos (v2)

```
Webhook
  └─► [PG] Get Stage Config         (nuevo)
        └─► [PG] Get CRM Context     (nuevo)
              └─► Build Context      (modificado)
                    └─► AI Agent     (herramienta nueva: archive_conversation)
                          └─► enviar texto
                                └─► [PG] Upsert Lead Cron       (nuevo)
                                      └─► [PG] Mark Responded    (nuevo)
                                            └─► Prepare Callback
                                                  └─► Callback
```

Los nodos `Get Stage Config` y `Get CRM Context` pueden ejecutarse **en paralelo** (no hay dependencia entre ellos).

### Herramientas del AI Agent

| Tool | Tipo | Cuándo la usa el agente |
|---|---|---|
| `activar_flow` | httpRequestTool | Enviar multimedia (video, audio) de ManyChat |
| `set_stage` | httpRequestTool | Detecta señal de cambio de etapa en el lead |
| `archive_conversation` | httpRequestTool (nuevo) | Lead sin interés o agotó el límite de seguimientos |

---

## Endpoints API Revolicord requeridos

### Existentes (a verificar)
- `POST /admin/leads/:id/stage` — actualizar etapa
- `POST /admin/turn-completed` — callback de turno

### Nuevos
- `POST /admin/conversations/:id/archive` — archivar conversación
- `GET/POST/PUT/DELETE /admin/funnel-stages` — CRUD de etapas
- `GET/POST/PUT/DELETE /admin/funnel-stages/:id/flows` — CRUD de flows por etapa
- `GET/POST/PUT/DELETE /admin/funnel-stages/:id/followups` — CRUD de plantillas
- `GET /admin/leads/:id/followup-history` — historial de follow-ups de un lead

---

## Orden de implementación recomendado

### Fase 1 — Base de datos (sin romper nada)
1. Ejecutar DDL de las 5 tablas nuevas
2. Ejecutar backfill de `subscribers.current_stage_id`
3. Insertar seed data en `funnel_stages`, `stage_flows`, `followup_templates`

### Fase 2 — `followup-runner` (nuevo workflow, no afecta al agent-run)
1. Crear workflow `followup-runner` en n8n
2. Probar con un lead de prueba (insert manual en `lead_crons`)
3. Verificar escritura en `n8n_chat_histories` y `lead_followup_log`

### Fase 3 — Modificar `agent-run`
1. Agregar nodos `Get Stage Config` y `Get CRM Context` (paralelos)
2. Modificar `Build Context` (eliminar FLOW_MAP, usar datos de DB)
3. Agregar herramienta `archive_conversation`
4. Agregar nodo `Upsert Lead Cron` después de `enviar texto`
5. Agregar nodo `Mark Responded` para actualizar `lead_followup_log`

### Fase 4 — API Revolicord
1. Endpoint `POST /admin/conversations/:id/archive`
2. Endpoints CRUD para funnel stages y flows
3. Endpoints CRUD para followup templates

### Fase 5 — Migración final (cuando todo funciona)
1. Hacer `current_stage_id NOT NULL`
2. Agregar trigger de sincronía (ADR-0014)
3. Deprecar FLOW_MAP del código legacy

---

## ADRs que soportan este documento

| ADR | Decisión |
|---|---|
| ADR-0010 | Funnel stages y flows en Postgres (reemplaza FLOW_MAP) |
| ADR-0011 | `lead_crons` como detector de inactividad |
| ADR-0012 | `followup-runner` escribe en `n8n_chat_histories` |
| ADR-0013 | Contexto dual del agente (memoria + bloque CRM) |
| ADR-0014 | Migración de `lead_stage TEXT` a `current_stage_id UUID FK` |
| ADR-0015 | Sistema de follow-ups por etapa (`followup_templates` + runner) |
