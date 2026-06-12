# Prompt para Fable: Plan de implementación ADR-0024

## Rol y objetivo

Eres un arquitecto de software senior. Tu tarea es producir un **plan de implementación detallado y accionable** para el ADR-0024 de este proyecto: construir `apps/agent`, un motor de diálogo con patrones CALM sobre LangGraph.js, dentro de un monorepo TypeScript existente.

**Las decisiones de arquitectura ya están tomadas y cerradas.** No las re-debatas. Tu trabajo es descomponer la implementación en tareas concretas, identificar los archivos críticos a crear/modificar, definir los contratos de tipos exactos (Zod schemas), y señalar los riesgos técnicos reales de ejecución.

---

## Contexto del sistema actual

### Monorepo (pnpm workspaces)

```
apps/
  api/src/
    server.ts           # Fastify entry
    worker.ts           # BullMQ worker — AQUÍ se hace el await agent.runTurn()
    config.ts           # getConfig() — Zod env validation
    routes/
      webhook-manychat.ts       # inbound ManyChat
      admin/turn-completed.ts   # n8n llama esto para liberar lock (MUERE en Fase 4)
      admin/set-stage.ts        # transitions válidas hardcodeadas aquí (FUGA)
    services/
      debounce.ts / lock.ts / dispatch-n8n.ts  # dispatch-n8n.ts se reemplaza por dispatch-agent.ts
      subscribers.ts / tenants.ts / turns.ts / messages.ts / conversations.ts
    lib/
      redis.ts / db.ts / logger.ts / auth.ts / redis-keys.ts

packages/
  db/src/schema.ts      # Drizzle ORM — pgSchema 'api' — todas las tablas aquí
  shared/src/schemas/   # Zod schemas compartidos entre API y dispatch

docs/
  adr/0024-motor-dialogo-declarativo-agnostico.md   # La decisión completa
  n8n/nodes/            # Build Context v6 (~370 líneas JS sin tipos) — se porta a TS
  n8n/stages.md         # Etapas QC: A→MS→B→C→D con transiciones y cascadas
  n8n/system-prompt.md  # Prompt monolítico actual (mezcla plataforma + persona Alex)
```

### Flujo actual (a reemplazar en Fase 4)

```
BullMQ worker → dispatch-n8n.ts → POST n8n webhook → n8n workflow (Build Context + AI Agent) 
→ POST /admin/turn-completed → libera lock
```

### Flujo objetivo

```
BullMQ worker → dispatch-agent.ts → await apps/agent runTurn() 
→ retorna resultado → worker libera lock en finally
```

### Tablas Drizzle existentes relevantes

- `subscribers` (tenant_id, ig_id, manychat_subscriber_id, current_stage, metadata JSONB)
- `conversations` (tenant_id, subscriber_id, status, handoff_state JSONB — ADR-0023)
- `messages` (tenant_id, conversation_id, role, content, content_class, raw JSONB)
- `turns` (tenant_id, conversation_id, started_at, completed_at, lock_key)
- `tenants` (id, slug, config JSONB — incluye media_policy, notification_keywords, flows_by_stage)
- `funnel_stages`, `stage_flows`, `stage_transitions_map` — config del funnel en DB
- `followup_templates` — cadencias de followup

### Dependencias ya aprobadas en el stack

Fastify, BullMQ, Drizzle (postgres.js), Redis (ioredis), Zod, pino, vitest, tsup, tsx, Biome.

**Nueva dependencia aprobada por ADR-0024:** `@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres`.

---

## Decisiones cerradas (no re-abrir)

1. **`apps/agent` en TypeScript**, mismo monorepo, comparte `@dm-api/db` y `@dm-api/shared`.
2. **BullMQ worker llama al agente síncrono** (`await runTurn()`). No hay webhook, no hay callback_url, no hay turn-completed route en el camino nuevo.
3. **LangGraph.js como runtime** — solo para checkpointing (PostgresSaver), `interrupt()` para handoff, y orquestación del grafo. Toda la lógica de negocio (flow engine, dialogue stack, repair patterns) vive en TS puro testeable sin LangGraph.
4. **Flows declarativos en Postgres JSONB** (tabla `flow_definitions`), no YAML en disco. Vocabulario **cerrado**: tipos de step = `collect | action | branch | link`. Tipos de comando = `StartFlow | SetSlot | CancelFlow | Clarify | HumanHandoff | ReplyText | SendContent | ChangeStage | ScheduleFollowup`.
5. **Action registry en código**: `send_content`, `reply_text`, `change_stage`, `notify_human`, `schedule_followup`, `http_request` (declarativo simple). Agregar una action = un PR normal, nunca un fork de tenant.
6. **n8n NO está en el hot path conversacional.** Queda para back-office/integraciones (Calendly glue, notificaciones internas).
7. **Shadow mode** antes del cutover: `tenant.config.engine = 'n8n' | 'agent'`. El worker despacha a ambos; el agente nuevo corre dry-run loggeando comandos sin enviar nada.
8. **Tenant sintético "Bufete Gómez"** es el test de aceptación de agnosticidad: si onboardarlo requiere un PR fuera del action registry, hay una fuga de diseño.

---

## Grafo LangGraph objetivo

```
assemble_context → understand → flow_engine → execute_actions → respond
                                     ↕
                              [interrupt() si HumanHandoff]
```

### Patrones LangGraph a usar

```typescript
// State definition
import { Annotation, StateGraph, interrupt, Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const DialogueAnnotation = Annotation.Root({
  // input del turno
  turnInput: Annotation<TurnInput>,
  // contexto ensamblado
  context: Annotation<AssembledContext>,
  // comandos emitidos por el LLM
  commands: Annotation<DialogueCommand[]>,
  // estado de diálogo (stack + slots) — persiste entre turnos
  dialogueState: Annotation<DialogueState>,
  // resultado de ejecutar actions
  actionResults: Annotation<ActionResult[]>,
  // respuesta final
  response: Annotation<AgentResponse>,
});

// Checkpointer: PostgresSaver usando el mismo pool de Drizzle/postgres.js
// thread_id = conversation_id (UUID de la tabla conversations)

// Human handoff via interrupt()
const flowEngineNode = async (state: ...) => {
  // si el flow engine emite HumanHandoff:
  const agentDecision = interrupt({ reason: cmd.reason, conversationId: ... });
  // el grafo queda suspendido; Telegram notifica; humano responde via resume
};
```

---

## Los dos tenants — usar ambos para validar el diseño

### Quantum Creators (real, ya en prod)

| Campo | Valor |
|---|---|
| Etapas | `A → MS → B → C → D` |
| Descalificación | `no_money`, `not_interested`, `geographic`, `no_quality`, `fake_account` |
| Cascada A→MS | envía audio + VSL, avanza a B |
| Conectores | `calendly` (macro B→C), futuro `close_crm` |
| Persona | "Alex", tono seco, cero admisión de IA |
| Escalado | audio/keywords → Telegram |
| Canal | Instagram vía ManyChat |

### Bufete Gómez & Asociados (sintético — test de agnosticidad)

| Campo | Valor |
|---|---|
| Etapas | `intake → conflict_check → consulta_agendada → retained` |
| Descalificación | `conflicto_de_interés`, `jurisdicción_equivocada`, `materia_no_practicada`, `no_puede_pagar_anticipo` |
| Cascada intake→conflict_check | dispara conector `check_conflicts` (API ficticia), espera resultado |
| Conectores | `check_conflicts`, agenda propia (no Calendly) |
| Persona | Asistente formal del bufete, trato de usted, disclaimers legales |
| Escalado | mismas keywords distintas: "demanda", "urgente", "plazo vence" |
| Canal | Instagram hoy; WhatsApp (prueba futura del channel adapter) |

**Regla de diseño:** si el vocabulario de flows puede expresar ambos tenants en Postgres JSONB sin código tenant-specific, el motor es agnóstico.

---

## Lo que debes producir

Un plan de implementación con las siguientes secciones. Sé concreto: nombres de archivos reales, shapes de tipos Zod, nombres de tablas Drizzle, comandos de CLI.

### 1. Estructura de `apps/agent`

Árbol de directorios completo con descripción de cada archivo. Incluye `package.json`, `tsconfig.json`, cómo se registra en el workspace.

### 2. Fase 1 — Contratos Zod (2-3 días, sin runtime)

Produce los shapes **completos** de los schemas Zod para:

- `DialogueCommand` (discriminated union de los 9 tipos de comando)
- `FlowStep` (discriminated union: `collect | action | branch | link`)
- `FlowDefinition` (con versionado para no romper leads en curso)
- `DialogueState` (stack LIFO + slots + current_flow_id + repair_context)
- `TurnInput` (lo que el worker le pasa al agente)
- `AgentResponse` (lo que el agente retorna al worker)
- `RepairPattern` enum: `human_handoff | cannot_handle | continue_interrupted | clarify | correction`

Muestra cómo `TRANSITION_MACROS` del Router v4.5 y `stages.md` se traducen a `FlowDefinition` JSONB para QC. Luego haz lo mismo para el Bufete sintético. Si algo no se puede expresar, es una fuga de diseño — señálala.

### 3. Migración de base de datos (nuevas tablas Drizzle)

Schema Drizzle exacto para:
- `flow_definitions` (tenant_id, flow_id, version, definition JSONB, active boolean)
- `dialogue_states` (conversation_id, stack JSONB, slots JSONB, updated_at) — alternativa: usar el checkpoint de LangGraph directamente y no duplicar
- Decisión explícita: ¿usamos `dialogue_states` propia o confiamos en el checkpoint de LangGraph? Argumenta.

### 4. Fase 2 — `apps/agent` implementación (1-1.5 semanas)

Para cada nodo del grafo, especifica:

**`assembleContext`**
- Qué datos carga (messages, subscriber, tenant config, handoff_state, followup history)
- Cómo porta Build Context v6 (las funciones clave: `pickWeighted`, `collapseVariantGroups`)
- Tests unitarios prioritarios (el bug de variantes v5 a cubrir)

**`understand`**
- Prompt de sistema: esqueleto de plataforma (cómo emitir comandos, repair patterns) + bloque de persona del tenant (separados, no monolíticos)
- Structured output con Claude Sonnet 4.6 (`claude-sonnet-4-6`) via `@anthropic-ai/sdk` o `@langchain/anthropic`
- Cómo se valida que el LLM emite solo comandos del vocabulario cerrado (Zod parse del output)

**`flowEngine`**
- Algoritmo del dialogue stack LIFO (push flow, pop al completar, `pattern_continue_interrupted`)
- Cómo ejecuta cada tipo de step (`collect`, `action`, `branch`, `link`)
- Cómo se generan comandos sin LLM desde Fastify (ej: `HumanHandoff(reason=audio)`) y entran al mismo motor
- El `interrupt()` de LangGraph para `HumanHandoff`: qué se persiste, cómo se resume

**`executeActions`**
- Interface `ActionHandler` del registry
- Implementación del adapter ManyChat (el "puerto" — mañana puede ser web chat)
- Cómo `change_stage` reemplaza a `set-stage.ts` sin las fugas (`VALID_TRANSITIONS` como datos)
- Eventos de dominio emitidos: `lead.stage_changed`, `conversation.escalated`, `content.sent`

**`respond`**
- Qué persiste en `turns`, `messages`, checkpoint de LangGraph
- Qué retorna al worker (el lock se libera en `finally` del worker, no aquí)

### 5. Integración con el worker existente

Muestra el diff exacto de `apps/api/src/worker.ts`:
- Cómo se agrega `dispatch-agent.ts` junto a `dispatch-n8n.ts`
- Cómo `tenant.config.engine` hace el routing (shadow mode)
- Cómo el lock se libera en `finally` sin depender de `turn-completed`

### 6. Fase 3 — Shadow mode

- Qué se loguea en dry-run (comandos emitidos, flow path tomado, diff con respuesta de n8n)
- Cómo se usa `messages_raw` como dataset de eval/replay
- Criterio de paridad para hacer cutover (% de turnos con respuesta equivalente)

### 7. Riesgos técnicos reales (no genéricos)

Para cada riesgo identifica: probabilidad (A/M/B), impacto, mitigación concreta.

Mínimo cubrir:
- Regresión del comportamiento conversacional de Alex (el riesgo #1 del ADR)
- Compatibilidad de `@langchain/langgraph-checkpoint-postgres` con el pool de `postgres.js` que usa Drizzle (LangGraph usa `node-postgres` / `pg` internamente)
- Disciplina de alcance del vocabulario de flows (cuándo agregar un nuevo tipo de step)
- Migración de `n8n_chat_histories` (formato interno LangChain) a la nueva memoria
- El bug de "Maximum call stack exceeded" en el Router n8n como señal de lo que NO reproducir

### 8. Checklist de done por fase

Criterios de aceptación binarios (sí/no) para declarar cada fase completa. La Fase 1 debe incluir: "el vocabulario de flows expresa tanto a QC como al Bufete sintético sin código tenant-specific".

---

## Restricciones del plan

- **Sin big-bang**: hay leads vivos en producción. El estrangulador (shadow mode → cutover por tenant) es obligatorio.
- **Sin inner-platform effect**: el vocabulario de flows es cerrado. Si necesitas "cualquier función JS en YAML", es la señal de que cruzaste la línea.
- **Sin duplicar estado**: un solo estado de diálogo por conversación. No recrear "las dos memorias que no se hablan".
- **Regla de oro LangGraph**: la lógica de negocio (flow engine, repair patterns, action handlers) debe ser TS puro testeable con vitest sin instanciar LangGraph. LangGraph es solo el runtime que los orquesta.
- **Regla de gold del ADR**: si onboardar al Bufete requiere un PR fuera del action registry, hay una fuga de diseño.
- **Convención de commits**: `feat(agent):`, `test(agent):`, `feat(db):`, etc. CI = lint + typecheck + build + test.

---

## Formato de salida esperado

Markdown estructurado con headers por sección. Código TypeScript real donde sea relevante (no pseudocódigo). Tablas donde ayuden a comparar opciones. Señala explícitamente cuando algo requiere una decisión del founder antes de continuar (máximo 2-3 decisiones abiertas — el resto ya está cerrado en el ADR).
