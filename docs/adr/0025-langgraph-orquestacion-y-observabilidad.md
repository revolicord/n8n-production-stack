# ADR-0025: LangGraph.js para la orquestación + observabilidad propia del motor

- **Estado:** aceptado
- **Fecha:** 2026-06-12
- **Decisores:** founder + Claude Code
- **Relacionado:** ADR-0024 (motor de diálogo declarativo), ADR-0023 (handoff + medios)

## Contexto

El ADR-0024 decidió mover el agente de n8n a `apps/agent` (mismo monorepo TS) y, textualmente,
adoptar **LangGraph.js** para la plomería: *"Lo que LangGraph sí da y vale la pena: checkpointing
en Postgres, `interrupt()` (human-in-the-loop nativo), reintentos, streaming y observabilidad."*
El cerebro CALM (dialogue stack, slots, flows declarativos, repair patterns) se escribiría propio
porque LangGraph no lo provee — es el IP del producto.

La **implementación se desvió** de esa decisión. Al revisar `apps/agent`:

1. **LangGraph nunca se instaló** (no estaba en `apps/agent/package.json`).
2. `graph/build-graph.ts` no es un grafo: son 5 funciones async llamadas en secuencia a mano
   (`assemble_context → understand → flow_engine → execute_actions → respond`). `graph/annotation.ts`
   `GraphState` es una `interface` plana, no `Annotation` de LangGraph.
3. El "checkpoint" es un `UPDATE` manual a `dialogue_states` (`saveDialogueState`).
4. El handoff a humano es un flag `repair_context='human_handoff'` + `resume.ts`, no `interrupt()`.
5. **No hay observabilidad.** Casi todo el estado del turno (contexto ensamblado, prompt enviado,
   razonamiento del LLM, flow path, memoria antes/después) vive solo en `GraphState` en memoria y
   se descarta. En el camino real (`engine='agent'`) solo sobrevive la fila resumen de `turns`.
   El campo `reasoning` que el LLM ya emite (`LlmPlanSchema.reasoning`) se **tira** en
   `understand.ts`. No hay forma de depurar un turno después, como sí se hacía con la pestaña
   *Executions* de n8n.

El objetivo del founder: recuperar el debug "a máxima expresión" que daba n8n, sin acumular deuda
técnica de un motor de orquestación 100% propio y con respaldo de comunidad cuando haya problemas.

## Decisión

### 1. Adoptar LangGraph.js solo para la plomería (ejecutar lo que el ADR-0024 ya ratificó)

- `graph/build-graph.ts` pasa a ser un `StateGraph` real (nodos + edges). Los nodos **envuelven las
  funciones actuales** casi sin cambios.
- **El cerebro CALM (`core/flow-engine/engine.ts`) permanece 100% propio e intacto** — se invoca
  dentro del nodo `flow_engine` como función pura. LangGraph no lo toca. Sigue siendo el IP que se
  mejora libremente.
- Checkpointer `PostgresSaver` (`@langchain/langgraph-checkpoint-postgres`) en el schema `api`,
  `thread_id = conversation_id`. Crea sus propias tablas; habilita `interrupt()` y reintentos.
- Handoff a humano migra a `interrupt()` + `Command({ resume })` nativos (ADR-0023 se conserva:
  `notifyHumanHandler` sigue creando `notifications` + Telegram).

### 2. `dialogue_states` sigue siendo la fuente de verdad legible

El checkpointer de LangGraph guarda un blob opaco optimizado para resumir ejecución. Para el debug
legible y el dashboard, **`dialogue_states` sigue siendo canónica**: `assemble_context` la lee como
verdad al inicio del turno y `respond` la escribe al final (como hoy). El checkpoint se usa **solo**
para durabilidad de ejecución e `interrupt()/resume`. Se acepta la pequeña duplicación (proyección).

### 3. Observabilidad propia y legible, además de LangSmith

LangSmith da la traza técnica del grafo con solo variables de entorno
(`LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`) — **provisional**, aceptado por
ahora porque no hay datos críticos. **Además**, una tabla propia en Postgres:

- **`agent_turn_traces`** (reemplaza `agent_shadow_runs`, nueva en migr. 0015 y sin datos en prod):
  una fila por ejecución (`mode: live|shadow|replay`) con `input`, `context_snapshot`, `prompt`
  (`system_prompt` + `messages`), `reasoning`, `commands`, `action_results`, `flow_path`,
  `response_texts`, `final_stage`, `dialogue_state_before/after`, `error {node,message,stack}`,
  `metrics`. Es el equivalente legible y consultable por SQL de una *execution* de n8n, sin depender
  del SaaS y sin sacar PII de la infra.
- Se deja de descartar el `reasoning`. Logs pino por nodo para tail en vivo. Nivel configurable por
  tenant (`trace_level: off|metrics|full`) + retención (`trace_retention_days`, default 30).

### 4. Versiones (dependencias nuevas — este ADR las autoriza, CLAUDE.md lo exige)

- `@langchain/langgraph@1.4.1` (línea actual, alineada con doc/comunidad).
- `@langchain/langgraph-checkpoint-postgres@1.0.3`, `@langchain/core@1.1.48`.
- Implica subir `zod` `3.23.8 → 3.25.76` en todo el workspace (peer de LangGraph 1.x). Bump menor,
  backward-compatible; validado con `pnpm typecheck` + `pnpm test` (128 tests verdes) sin cambios de
  código. Alternativa descartada: fijar LangGraph 0.4.x (zod aislado, sin bump) — se rechazó por
  adoptar una versión un major por detrás de la comunidad (deuda futura), contrario a la razón de
  elegir LangGraph.

## Consecuencias

**Positivas:** menos plomería propia que mantener; comunidad/doc para orquestación, checkpoint,
human-in-the-loop y reintentos; observabilidad legible recuperada (paridad con n8n) y consultable
por SQL; el cerebro CALM sigue siendo propio y evolucionable.

**Negativas / riesgos:** LangGraph.js (JS) tiene menos comunidad que la versión Python; dependencia
provisional de LangSmith (SaaS externo, PII — mitigable migrando a observabilidad 100% propia más
adelante); doble store de estado (`dialogue_states` + checkpoint) que hay que mantener coherente;
refactor de la plomería durante la transición (mitigado: el agente aún no está en prod —
`engine='n8n'`— se valida en shadow + `parity-report.sql` antes del cutover Fase 4).

**Supersede parcialmente** la sección de implementación del ADR-0024: la plomería deja de ser
"runner secuencial a mano" y pasa a `StateGraph`; el handoff por flag pasa a `interrupt()`.
El resto del ADR-0024 (cerebro CALM, flows declarativos, fases, criterios de cutover) se conserva.
