# 15 · Optimización de tokens y fast-path determinista

> **Por qué este documento existe.** Un asistente conversacional que llama al LLM en
> cada turno es caro y lento. Este sistema está diseñado para que el **camino feliz
> guionizado consuma CERO tokens** y para que cada turno deje por escrito *por qué*
> consumió (o no) tokens. Si construyes asistentes, esta es la pieza más importante
> para controlar el costo. Documenta la arquitectura completa: prompt caching,
> fast-path determinista, ruteo declarativo, señales editables y observabilidad.

Audiencia: ingeniería (cómo funciona y cómo extenderlo) y operación/dashboard (cómo
configurarlo sin tocar código).

---

## 0. TL;DR

| Optimización | Qué hace | Efecto |
|---|---|---|
| **Fast-path determinista** | Un 👍 / "ya lo vi" en una etapa `flow_only` avanza sin llamar al LLM | **0 tokens**, ~0 ms de LLM |
| **Circuit breaker / stuck detector** | Lead atascado N turnos en una etapa sin avanzar → escala/descalifica sin LLM | **0 tokens**; corta la cola caótica |
| **Reasoning adaptativo** | Longitud del `reasoning` según dificultad (no fija) | Menos tokens de **salida** ($15/M) |
| **Prompt caching** | Cachea el prefijo estable del system + el tool schema | Input cacheado se cobra al ~10% |
| **Transcript acotado** | Historial limitado a 10 turnos | Recorta el input que crece con la conversación |
| **Ruteo declarativo** | La transición declara `trigger:'affirm'` | Determinismo robusto, no inferido de la topología |
| **Señales editables** | `affirm_signals` por tenant | El dashboard agrega variaciones sin deploy |
| **Observabilidad** | `decision_path` + `fast_path_skip_reason` por turno | Diagnóstico sin leer código |

Resultado esperado en producción: en etapas `flow_only` (camino feliz), un 👍 sale
con `decision_path: fast_path`, `tokens_entrada: 0`, sin razonamiento del LLM.

---

## 1. El problema

Antes de esto, **todo mensaje** del lead pasaba por el nodo `understand`, que llama al
LLM. Incluso un pulgar arriba (👍) en una etapa totalmente guionizada gastaba
~900–3000 tokens de input y ~4–5 segundos. Eso es absurdo: cuando el lead confirma en
el camino feliz no hay *nada que pensar* — solo hay que avanzar de etapa y dejar que
la cascada del funnel entregue el contenido.

El costo de input de un turno LLM se descompone así (aprox.):

```
tool schema emit_plan        ~730 tok
system skeleton (reglas)    ~1050 tok
persona + diálogo           ~300–700 tok
overhead tool-use Anthropic  ~300–500 tok
transcript (crece)            0 → 2000+ tok
```

Dos frentes de ataque: (a) **no llamar al LLM** cuando no hace falta (fast-path), y
(b) **abaratar** las llamadas que sí ocurren (caching + transcript acotado).

---

## 2. Arquitectura del turno (dónde se decide el gasto)

El agente es un `StateGraph` de LangGraph (ADR-0025). El gasto se decide en
`prepare_prompt` → `understand`.

```
START
 └─ assemble_context   carga etapa, transiciones (con trigger), transcript(10), dialogue_state, handoff
 └─ prepare_prompt     ⟵ DECISIÓN: fast-path (0 tok) vs LLM
 │                       tryFastPath(input, ctx)
 │                         kind:'fast_path' → { fastPath, decision_path='fast_path' }   (no LLM)
 │                         kind:'llm'       → { llmRequest, fast_path_skip_reason }
 └─ understand         si fastPath → emite ChangeStage SIN LLM
 │                     si no → callLlm() (única parte que ve LangSmith)
 └─ flow_engine        cerebro CALM: valida comandos, calcula cascada, flow_path
 └─ handoff | execute_actions   ejecuta SendContent/ChangeStage/ReplyText reales
 └─ respond            persiste turno + traza (agent_turn_traces) + debug webhook
END
```

Archivos clave:
- `apps/agent/src/graph/build-graph.ts` — el grafo y los nodos.
- `apps/agent/src/graph/nodes/fast-path.ts` — el fast-path determinista.
- `apps/agent/src/core/llm/prompt.ts` — split estable/volátil del system.
- `apps/agent/src/core/llm/client.ts` — `cache_control` y métricas de cache.
- `apps/agent/src/services/traces.ts` — la traza legible (`agent_turn_traces`).

---

## 3. Fast-path determinista (cero tokens)

`tryFastPath(input, ctx)` decide, **sin LLM**, si el turno es un avance del camino
feliz. Devuelve un resultado explícito:

```ts
type FastPathDecision =
  | { kind: 'fast_path'; result: { commands; reason } }   // avanza sin LLM
  | { kind: 'llm'; skipReason: FastPathSkipReason };       // cae al LLM, y dice por qué
```

### 3.1 Compuertas (en orden)

El turno toma el fast-path **solo si TODO esto se cumple**:

1. No hay `system_commands` inyectados (eventos de webhook van por el flujo normal).
2. Hay al menos un mensaje del lead.
3. **Todos** los mensajes son `content_class: 'text'` (audio/imagen ⟹ posible escalado).
4. **Todos** los textos son una señal positiva inequívoca (ver §5). Una pregunta
   (`?`/`¿`) nunca cuenta.
5. No hay `repair_context` activo ni escalación a humano abierta.
6. La etapa está en política `flow_only` (`text_policy_by_stage` / `text_policy_default`).
7. Existe **exactamente una** transición con `trigger:'affirm'` desde la etapa actual (§4).

Si alguna falla, devuelve `{ kind:'llm', skipReason }` y el motivo queda en la traza.

### 3.2 Qué emite

```ts
{ type: 'ChangeStage', to_stage: <destino affirm>, cascade: true, system_authorized: false }
```

El `cascade:true` hace que el flow de la nueva etapa entregue su contenido
(audio + VSL, link de Calendly, etc.). El lead **nunca queda en visto** aunque no
haya texto del LLM, porque la cascada entrega contenido visible.

> **Modo conservador.** Ante la mínima ambigüedad cae al LLM. Es preferible gastar
> tokens de más que avanzar de etapa por error. Por eso el fast-path solo cubre el
> caso inequívoco; objeciones, dudas y "sí asustados" los maneja el LLM.

---

## 4. Ruteo declarativo: por qué `trigger`, no la topología

**Decisión de arquitectura (la más importante de esta pieza).** El destino del avance
**se declara en el dato**, no se infiere de la forma del grafo.

### 4.1 El antipatrón que evitamos

La primera versión infería "el avance feliz" como *"la única arista no-terminal"*.
Es un proxy frágil: toda etapa tiene una escotilla `→disqualified`, así que siempre
hay ≥2 aristas. Dependía de marcar `is_terminal` a mano (que el seed no hacía) y se
rompía con cualquier bifurcación legítima (p. ej. `B→C` y `B→nurture`). Resultado real
en producción: `fast_path_skip_reason: ambiguous_target` en **todas** las etapas → el
👍 siempre iba al LLM.

La intención de ruteo *ya existía*, pero solo en prosa legible por el LLM
(`stage_transitions_map.when_to_use = "Lead da una señal positiva…"`). El motor
determinista estaba ciego a ella. Pagábamos una llamada al LLM para re-derivar algo
que un humano ya había escrito.

### 4.2 La solución

Columna `trigger` en `stage_transitions_map` (`packages/db/src/schema.ts`,
migración `0020`):

| `trigger` | Significado | Lo usa el fast-path |
|---|---|---|
| `'affirm'` | Avance del camino feliz ante señal positiva | **Sí** — el destino |
| `'deny'` | Escotilla de rechazo / descalificación | No (lo decide el LLM) |
| `null` | Sin disparador determinista; lo decide el LLM | No |

El fast-path toma la arista `trigger==='affirm'`. **No cuenta aristas, no mira
`is_terminal`.** Esto es robusto:

```
A → B            trigger: 'affirm'   ← avanza aquí, sin LLM
A → disqualified trigger: 'deny'     ← ignorada

B → C            trigger: 'affirm'   ← bifurcación: avanza a C
B → nurture      trigger: 'deny'     ← y aquí no hay ambigüedad
```

Editable en el panel (`PUT /admin/stage-transitions/:id`, campo `trigger` ∈
`affirm|deny|null`). El backfill de la migración 0020 marca conservadoramente las
transiciones existentes (`deny`→`disqualified`, `affirm`→el resto, solo donde es NULL).

> **Regla:** una etapa `flow_only` debe tener **exactamente una** transición
> `trigger:'affirm'`. 0 ⟹ `no_affirm_transition`; >1 ⟹ `ambiguous_target`. Ambos
> aparecen en la traza y se corrigen en el panel, no en código.

---

## 5. Señales positivas editables por tenant (`affirm_signals`)

Las señales que disparan el fast-path **no están hardcodeadas**: el equipo del
dashboard puede agregar variaciones que surjan ("oki", "ya quedó", "perfe", emojis
nuevos) **sin deploy**. El 👍 siempre funciona.

### 5.1 Defaults del sistema

`apps/agent/src/graph/nodes/fast-path.ts`:

- **Frases** (`DEFAULT_POSITIVE_PHRASES`): `si, ok, oka, okey, okay, vale, listo,
  dale, va, perfecto, genial, hecho, ya, ya esta, ya lo vi, ya la vi, ya vi, lo vi,
  la vi, visto, confirmo, confirmado, correcto, entendido, de acuerdo, sip, simon,
  claro`.
- **Emojis** (`DEFAULT_POSITIVE_EMOJI`): `👍 👌 ✅ 🙌 🔥 💪 🙏 👏 🤝`.

Normalización del input antes del match (frases): NFD sin acentos, lowercase, sin
signos `. , ! ¡ … ·`, espacios colapsados, **match EXACTO de la frase completa**.
Emojis: se quitan tonos de piel / variation selector / ZWJ y se compara "pelado", así
`👍`, `👍👍`, `👍🏽`, `👍🔥` cuentan todos.

### 5.2 Override por tenant

Campo `affirm_signals` en la config del tenant
(`packages/shared/src/schemas/tenant-config.ts`, `AffirmSignalsSchema`):

```jsonc
{
  "affirm_signals": {
    "phrases": ["oki", "ya quedó", "perfe", "de una"],  // variaciones extra
    "emojis":  ["🤙", "💯"],                              // emojis extra
    "mode":    "extend"                                   // "extend" (default) | "replace"
  }
}
```

- **`mode: "extend"`** (default): las frases del tenant **se suman** a los defaults.
  Es lo que el dashboard usará el 99% del tiempo: "agregá esta variación".
- **`mode: "replace"`**: usa **solo** las frases del tenant (control total). Aun así,
  **los emojis de aprobación base SIEMPRE se conservan** — el 👍 nunca deja de ser
  cero-tokens.
- Las frases del tenant se **normalizan igual que el input**: podés escribir
  `"Oki!"` o `"YA QUEDÓ"` y matchea igual.

Resolución: `resolveAffirmSignals(tenantConfig)` → `{ phrases, emojis }`. Si el tenant
no define nada, usa los defaults (robusto por construcción).

### 5.3 Cómo lo configura el dashboard

`affirm_signals` vive en la config JSON del tenant, validada por Zod. Se setea por el
mismo camino que el resto de la config self-service (panel `/settings`). Para exponerlo
como UI dedicada, agregar un editor de lista en el panel que escriba
`config.affirm_signals.phrases`. Mientras tanto es editable vía el endpoint de
actualización de tenant config.

> **Guía operativa.** Si ves muchos turnos con `fast_path_skip_reason:
> not_positive_signal` y al leer `mensajes_lead` son confirmaciones claras
> ("listo jefe", "oki doki"), **esa es la señal de agregar la variación** a
> `affirm_signals.phrases`. Cada variación agregada = más turnos a cero tokens.

---

## 5b. Circuit breaker / stuck detector (la cola caótica)

El fast-path acota el costo del turno **normal** (un 👍 a cero tokens). El circuit breaker
acota el costo de la conversación **patológica**: el lead que da vueltas 20 turnos en la
misma etapa sin avanzar y le sangra dinero al dueño del setter. Optimizar tokens reduce la
**media**; el breaker controla la **cola** (la distribución), que es donde realmente se
fuga el presupuesto.

Es un **segundo gate determinista** (cero tokens), análogo al fast-path
(`graph/nodes/stuck-breaker.ts`, nodo `prepare_prompt`). Solo se evalúa **cuando el turno
iba a caer al LLM** (el fast-path ya no aplicó). Un 👍 que avanza por fast-path resetea la
cuenta (nueva etapa) → el breaker solo dispara en atascos reales.

### 5b.1 Señal y umbral

`turnsInCurrentStage` = turnos COMPLETADOS del lead desde que entró a la etapa actual (se
cuenta desde el último `stage_transitions.created_at`; ver `loadTurnsInCurrentStage`). Si
≥ `max_turns_in_stage` (default 10 — un lead sano avanza cada 1–3) → corta:

- **`handoff`** (default): emite `HumanHandoff(kind:'agent', source:'code')` → reusa toda
  la maquinaria de escalación (interrupt nativo + notificación Telegram + pausa). No pierde
  el lead.
- **`disqualify`**: avanza por la transición declarada `trigger:'deny'` desde la etapa; si
  no hay ninguna, **cae a `handoff`** (nunca descalifica a ciegas).

### 5b.2 Modo conservador (cuándo NO dispara)

`tryStuckBreaker` devuelve `pass` con un `skipReason` (observabilidad, análogo a
`fast_path_skip_reason`):

| skipReason | Significado |
|---|---|
| `disabled` | el tenant lo apagó (`stuck_detector.enabled=false`) |
| `exempt_stage` | etapa terminal (`is_terminal`) o listada en `exempt_stages` |
| `already_handling` | ya hay escalación abierta o repair_context (humano en el caso) |
| `under_threshold` | aún no llega al umbral (caso normal) |

`decision_path: stuck_breaker` en la traza (y `context_snapshot.turns_in_current_stage`
explica el porqué). Cuenta como turno determinista en `GET /admin/agent-savings`.

---

## 6. Prompt caching (abaratar las llamadas que sí ocurren)

Cuando el turno **sí** va al LLM, abaratamos el input con el prompt caching de
Anthropic (`cache_control: { type: 'ephemeral' }`, TTL 5 min, input cacheado al ~10%).

`composePrompt` (`core/llm/prompt.ts`) parte el system en dos:

- **`stable`**: vocabulario de comandos + reglas + persona. Idéntico turno a turno →
  se cachea (breakpoint `ephemeral`).
- **`volatile`**: transiciones / contenido / contexto de diálogo. Cambia cada turno →
  fuera del prefijo cacheado.

El **tool schema `emit_plan`** también lleva `cache_control` (es grande y constante).

Métricas: `cacheReadTokens` / `cacheWriteTokens` se propagan a logs y a la traza
(`cache_read_tokens` / `cache_write_tokens`). Un `cache_read_tokens > 0` confirma que
el caching está activo.

> No baja el *conteo* de tokens; baja el *costo*. Reaprovechable entre turnos y entre
> leads del mismo tenant dentro de la ventana de 5 minutos.

### 6.1 Reasoning de longitud adaptativa (ventana móvil)

El `reasoning` del plan **no alimenta la lógica** (lo consumen solo trazas + el feedback
loop Fase 4), pero como forzamos `tool_choice: emit_plan` y NO usamos `thinking`, es la
**única superficie de razonamiento del modelo** — y se cobra a precio de salida ($15/M,
5× la entrada). El skeleton instruye una longitud **variable, no fija**: una frase cuando
la intención es clara, 2–3 solo ante objeción/ambigüedad. Es una "ventana móvil" barata
(prompt-level, cero cambios de API) que ataca el token más caro del turno sin perder
calidad cuando la decisión es difícil. Ver `platform-skeleton.ts` (regla 11).

### 6.2 Transcript por umbral + compresión lossless (NO resumen por LLM)

Resumir con el LLM contenido barato cuesta más de lo que ahorra: el resumen se **genera**
a precio de salida ($15/M) pero **ahorra** a precio de entrada ($3/M) → factor 5× en
contra. Para 3 👍 seguidos (R≈300 tok) el "remedio es peor que la enfermedad". Por eso el
transcript NO se resume con LLM; se optimiza en tres capas baratas (`transcript.ts`):

1. **Estado estructurado primero (gratis):** la etapa + los slots + el dialogue_state YA
   son un resumen comprimido de lo "consumido". El transcript solo aporta coherencia local.
2. **Compresión lossless:** `collapseTrivialRuns` colapsa runs idénticos consecutivos
   (`👍/👍/👍` → `👍 (×3)`), sin perder la señal de repetición y sin LLM.
3. **Recorte por presupuesto:** `trimToTokenBudget` conserva los mensajes MÁS recientes que
   entren en `transcript_max_tokens` (default 1200) y descarta lo viejo — seguro porque el
   estado estructurado ya lleva lo consumido. Siempre conserva los últimos 4 mensajes.

Transcript acotado: `assemble-context.ts` limita el historial a **10 turnos** (antes
20); luego se comprime y recorta por presupuesto.

---

## 7. Observabilidad: diagnóstico sin leer código

Cada turno deja escrito **qué camino tomó y por qué**. Esta es la cadena que permite
depurar sin abrir el repo.

### 7.1 Campos en la traza (`agent_turn_traces` / debug webhook)

- **`decision_path`**: `fast_path` | `llm` | `system` | `none`.
  - `fast_path` → resuelto sin LLM (0 tokens). `system` → solo evento de sistema (0
    tokens). `llm` → se llamó a Claude. `none` → error antes de decidir.
- **`fast_path_skip_reason`** (cuando `decision_path='llm'`): por qué no fue
  determinista.
- **`context_snapshot`** (con `trace_level: full`): incluye `funnel_stages` (con
  `is_terminal`) y `transitions` (con `trigger`) → ves el dato de ruteo sin abrir la DB.
- **`metrics`**: `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_write_tokens`, `llm_ms`, más `decision_path` y `fast_path_skip_reason`.

### 7.2 Tabla de `fast_path_skip_reason`

| skipReason | Significado | Acción |
|---|---|---|
| `has_system_commands` | Llegó un evento de sistema (webhook) | Correcto, va por flujo normal |
| `no_messages` | Turno sin mensajes del lead | Correcto |
| `non_text_message` | Audio/imagen/etc. | Correcto (posible escalado) |
| `not_positive_signal` | El texto no matcheó una señal positiva (o es pregunta) | Si son confirmaciones claras → agregar a `affirm_signals` |
| `repair_context_active` | Reparación/handoff en curso | Correcto |
| `open_escalation` | Escalación a humano abierta | Correcto |
| `stage_not_flow_only` | La etapa no es `flow_only` | Si debería serlo → `text_policy_by_stage` |
| `no_affirm_transition` | Ninguna arista `trigger:'affirm'` desde la etapa | Marcar la transición de avance como `affirm` en el panel |
| `ambiguous_target` | >1 arista `trigger:'affirm'` | Dejar solo una `affirm` por etapa |

### 7.3 Runbook (de arriba a abajo, parás en el primer NO)

1. **¿Mi código está desplegado?** ¿La traza trae `decision_path`? No → falta `/ship`.
2. **¿La migración corrió?** `decision_path` siempre null → `make migrate`.
3. **¿Qué camino tomó?** `decision_path`. `llm` en un 👍 → paso 4.
4. **¿Por qué no fue determinista?** `fast_path_skip_reason` → tabla §7.2.

Tres lugares para leerlo, de más barato a más caro:
- **Logs del agente**: `grep "fast-path decision"` → `decision` + `skip_reason` por turno.
- **SQL**: `select decision_path, metrics->>'fast_path_skip_reason', count(*) from api.agent_turn_traces group by 1,2;`
- **Vista n8n** (emojis): requiere mapear `decision_path` / `fast_path_skip_reason` en
  el Code node de debug.

> **LangSmith NO sirve para esto.** Solo envuelve el cliente Anthropic
> (`wrapAnthropic`), no ve el grafo. Su "output" sale null porque forzamos
> `tool_choice: emit_plan` (la respuesta es un `tool_use`, no texto). En turnos
> fast-path no hay llamada → no aparece nada. La fuente de verdad es
> `agent_turn_traces`.

---

## 8. Métrica de ahorro

`GET /admin/tenants/:tenantId/agent-savings?days=30` (`apps/api`,
`services/agent-metrics.ts`) agrega `agent_turn_traces` por `decision_path`:

```jsonc
{
  "total_turns": 1240,
  "by_decision_path": { "fast_path": 410, "system": 60, "llm": 770, "none": 0 },
  "deterministic_turns": 470,
  "deterministic_pct": 37.9,
  "llm_turns": 770,
  "input_tokens_used": 686300,
  "avg_input_tokens_per_llm": 891,
  "estimated_input_tokens_saved": 418770
}
```

- `deterministic_pct`: % de mensajes resueltos **sin** LLM. El titular del ahorro.
- `estimated_input_tokens_saved`: turnos deterministas × media de input por turno LLM
  — los tokens que un agente "LLM-en-cada-turno" habría quemado y esta arquitectura no.

---

## 9. Referencia de configuración (todas las perillas)

| Config | Dónde | Efecto en tokens |
|---|---|---|
| `text_policy_by_stage` / `text_policy_default` | tenant config | Habilita `flow_only` (precondición del fast-path) |
| `stage_transitions_map.trigger` | DB / panel | Declara el destino del avance feliz (lo usa fast-path Y el breaker en `disqualify`) |
| `affirm_signals` | tenant config | Señales que disparan el fast-path (editable) |
| `transcript_max_tokens` | tenant config | Presupuesto del transcript (default 1200); recorte por umbral sin resumir |
| `stuck_detector` | tenant config | Circuit breaker: `enabled`, `max_turns_in_stage`, `action`, `exempt_stages` |
| `skeleton_prompt` / `persona_prompt` | tenant config | Componen el prefijo `stable` cacheado |
| `model` | tenant config | Modelo del turno LLM |
| `trace_level` | tenant config | `full` para ver `context_snapshot` en la traza |

---

## 10. Despliegue

1. `/ship` — rebuild de `apps/agent` + `apps/api` con el código nuevo.
2. `make migrate` — aplica migraciones:
   - `0019_agent_decision_path` — columna `decision_path` + índice.
   - `0020_stage_transition_trigger` — columna `trigger` + backfill conservador.
3. Verificación: enviá un 👍 en una etapa `flow_only`. La traza debe mostrar
   `decision_path: fast_path`, `tokens_entrada: 0`, sin razonamiento del LLM.

Si sale `ambiguous_target` o `no_affirm_transition`, revisá el `trigger` de las
transiciones de esa etapa en el panel (debe haber exactamente una `affirm`).

---

## 11. Extensibilidad (futuro)

- **Más triggers deterministas.** Hoy `affirm` dispara avance. Se podría agregar un
  trigger determinista para "no" claro (`deny` → `disqualified` sin LLM), con mucho
  cuidado: un falso positivo descalifica un lead. El modo conservador actual prefiere
  mandar los "no" al LLM.
- **Señales negativas editables** análogas a `affirm_signals`, si se habilita lo
  anterior.
- **Clasificador NLU** en vez de match exacto, si las variaciones explotan — pero eso
  reintroduce un modelo; el match exacto + `affirm_signals` editable cubre el 👍 y sus
  variantes a cero costo, que es el objetivo.

---

## Apéndice · archivos

| Archivo | Rol |
|---|---|
| `apps/agent/src/graph/nodes/fast-path.ts` | Fast-path, señales, `resolveAffirmSignals` |
| `apps/agent/src/graph/nodes/stuck-breaker.ts` | Circuit breaker / stuck detector |
| `apps/agent/src/core/memory/transcript.ts` | `collapseTrivialRuns` + `trimToTokenBudget` |
| `apps/agent/src/graph/build-graph.ts` | Nodo `prepare_prompt` (decide) + log de decisión |
| `apps/agent/src/graph/annotation.ts` | Estado: `decisionPath`, `fastPathSkipReason` |
| `apps/agent/src/core/llm/prompt.ts` | Split `stable`/`volatile` (caching) |
| `apps/agent/src/core/llm/client.ts` | `cache_control` + métricas de cache |
| `apps/agent/src/services/traces.ts` | Traza legible + `context_snapshot` |
| `apps/agent/src/services/context-queries.ts` | Carga de transiciones (con `trigger`) |
| `packages/shared/src/schemas/tenant-config.ts` | `AffirmSignalsSchema` |
| `packages/db/src/schema.ts` | Columnas `decision_path`, `trigger` |
| `apps/api/src/services/agent-metrics.ts` | Métrica de ahorro |
| `apps/api/src/routes/admin/stage-transitions-map.ts` | Edición de `trigger` |
| `apps/api/src/routes/admin/agent-metrics.ts` | Endpoint `/agent-savings` |
| `packages/db/drizzle/0019_*.sql`, `0020_*.sql` | Migraciones |
