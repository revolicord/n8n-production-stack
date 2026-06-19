# Observabilidad: LangGraph + LangSmith

Cómo el agente de `apps/agent` envía trazas automáticas a LangSmith y qué se puede ver ahí.

---

## Arquitectura de observabilidad (ADR-0025)

El agente tiene **dos capas** de observabilidad que conviven:

| Capa | Dónde vive | Para qué sirve |
|---|---|---|
| **LangSmith** | SaaS externo (`eu.api.smith.langchain.com`) | Traza técnica del grafo: cada nodo, el call al LLM, tokens, latencia |
| **`agent_turn_traces`** | Postgres propio (`api.agent_turn_traces`) | Traza de negocio legible por SQL: prompt enviado, reasoning del LLM, flow path, etapa final |

LangSmith es provisional y conveniente. La tabla propia es la fuente canónica que no depende de un SaaS y no sale PII de la infra.

---

## Cómo funciona el tracing (sin código extra)

### 1. LangGraph traza los nodos automáticamente

Cuando `LANGSMITH_TRACING=true` está en el entorno, `@langchain/langgraph` detecta las vars y envía una traza por cada `graph.invoke()`. Cada nodo del grafo aparece como un **span hijo**:

```
run-turn (raíz)
  └─ assemble_context
  └─ prepare_prompt
  └─ understand          ← aquí está el call a Anthropic
  └─ flow_engine
  └─ execute_actions
  └─ respond
```

No hay que instrumentar nada más: el grafo compilado en `build-graph.ts` ya es suficiente.

### 2. El call a Anthropic traza con `wrapAnthropic`

En `apps/agent/src/core/llm/client.ts`:

```typescript
import { wrapAnthropic } from 'langsmith/wrappers/anthropic';

const client = wrapAnthropic(
  new Anthropic({ apiKey: input.apiKey, ... })
);
```

`wrapAnthropic` intercepta `client.messages.create(...)` y añade el span del LLM (modelo, mensajes, tokens, tool calls) como hijo del nodo `understand`. No hay que pasar nada por contexto: la librería usa `AsyncLocalStorage` para propagar el trace ID automáticamente.

---

## Variables de entorno requeridas

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=dm-agent
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com   # EU region — obligatorio si te registraste en EU
```

> **Gotcha crítico:** `langsmith` ≥ 0.2 solo lee `LANGSMITH_*`. Las variables viejas `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY` son ignoradas silenciosamente. Si usas los nombres viejos, no hay error, simplemente no llega nada a LangSmith.

En producción, las vars se pasan al contenedor del agente vía `docker-stack.yml`:

```yaml
LANGSMITH_TRACING: ${LANGSMITH_TRACING:-}
LANGSMITH_API_KEY: ${LANGSMITH_API_KEY:-}
LANGSMITH_PROJECT: ${LANGSMITH_PROJECT:-dm-agent}
LANGSMITH_ENDPOINT: ${LANGSMITH_ENDPOINT:-}
```

El `:-` (sin default) significa que si la var no está en `.env`, se pasa vacía y LangSmith queda desactivado — sin romper el arranque.

El schema Zod en `apps/agent/src/config.ts` las declara como `optional()` por la misma razón:

```typescript
LANGSMITH_TRACING: z.string().optional(),
LANGSMITH_API_KEY: z.string().optional(),
LANGSMITH_PROJECT: z.string().optional(),
LANGSMITH_ENDPOINT: z.string().optional(),
```

---

## Qué se ve en LangSmith

Al entrar a un run en `https://eu.smith.langchain.com`:

- **Run tree**: los 5–6 nodos del grafo como spans anidados, con duración individual
- **Nodo `understand`**: el input (system prompt + mensajes) y el output (tool call `emit_plan`) ya renderizados como chat
- **Tokens y coste**: input/output tokens del call a Anthropic, desglosados por request (incluyendo el retry si el LLM falla la primera validación Zod)
- **Errores**: si el agente lanza una excepción en cualquier nodo, aparece en rojo con el stack trace
- **Metadatos del thread**: `thread_id = conversation_id` — se puede filtrar por conversación

---

## Ejemplo: retry del LLM visible en LangSmith

El cliente LLM tiene un retry automático cuando el plan no pasa la validación Zod. En LangSmith esto aparece como **dos** spans de Anthropic bajo el nodo `understand`, con el segundo teniendo el mensaje de corrección como input. Permite ver exactamente qué falló en la primera respuesta.

---

## Lo que LangSmith NO ve

- El estado de `dialogue_states` (antes/después del turno) — eso está en `agent_turn_traces`
- El `reasoning` del LLM (campo del `LlmPlanSchema`) — también en `agent_turn_traces`
- El flow path CALM (qué transiciones tomó `engine.ts`) — en `agent_turn_traces.flow_path`
- Los action results (qué flows/textos se enviaron) — en `agent_turn_traces.action_results`

Para debug de negocio, la fuente es SQL sobre `agent_turn_traces`:

```sql
SELECT
  t.id,
  t.mode,
  t.status,
  t.input->>'messages' AS messages,
  t.reasoning,
  t.flow_path,
  t.response_texts,
  t.metrics,
  t.error
FROM api.agent_turn_traces t
WHERE t.tenant_id = '<uuid>'
ORDER BY t.created_at DESC
LIMIT 20;
```

---

## Resumen de archivos clave

| Archivo | Rol en la observabilidad |
|---|---|
| `apps/agent/src/core/llm/client.ts` | `wrapAnthropic` — traza el call a Anthropic |
| `apps/agent/src/graph/build-graph.ts` | `StateGraph` — LangGraph traza cada nodo |
| `apps/agent/src/config.ts` | Declara las `LANGSMITH_*` vars (Zod optional) |
| `docker-stack.yml` (líneas ~435) | Pasa las vars al contenedor en Swarm |
| `.env` | Valores reales (no commiteado) |
| `.env.example` | Plantilla documentada |
| `apps/agent/src/services/traces.ts` | `saveTurnTrace` — capa propia en Postgres |
