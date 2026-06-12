# ADR-0024: Motor de diálogo declarativo (patrones CALM) sobre LangGraph.js — setter agnóstico al negocio

- **Estado:** propuesto (decisión de dirección tomada; ratificar al cerrar Fase 1)
- **Fecha:** 2026-06-12
- **Decisores:** founder + Claude Code
- **Modifica/supersede parcialmente:** ADR-0008 (frontera de inyección dinámica), ADR-0009 (agent-run en n8n), ADR-0012 (followups escribiendo en `n8n_chat_histories`), ADR-0017 (watchdog del callback)

---

## Contexto

El sistema lleva meses acumulando reglas de negocio dispersas en cuatro capas:
Fastify (keywords de escalado, matriz de medios, transiciones válidas), n8n
(Build Context, Router, system prompt), Postgres (`flows_by_stage`,
`stage_flows`, `funnel_stages`, `tenant.config`) y ManyChat (los flows mismos).
Cada mejora se convierte en una odisea; el escalado a humano (ADR-0023) lo hizo
evidente, y aún falta que el agente sea consciente de lo que se habla fuera (app
nativa de Instagram, web) y de los follow-ups que se entregan al lead.

### La evidencia de que la arquitectura reventó (del propio repo)

1. **El Router viola el ADR-0008 que lo justifica.** ADR-0008 dice: "Fastify no
   conoce las etapas; cualquier tenant nuevo se controla con JSON en Postgres,
   sin tocar código ni nodos". Pero `TRANSITION_MACROS` en el Router v4.5 tiene
   hardcodeado `'QC_MS_AUDIO_se envia antes de la vsl'` — slugs de Quantum
   Creators dentro de un nodo JS genérico. El segundo tenant que entre obliga a
   editar el Router a mano en la UI. La regla multi-tenant ya está rota.

2. **El historial de versiones es el síntoma.** Router: 9 versiones, y los fixes
   son contra la plataforma, no contra el dominio — `ObservableObject` proxies de
   n8n, `Maximum call stack size exceeded`, sintaxis `={{ }}` vs `{{ }}`, formato
   roto de `queryReplacement`. Build Context: 6 versiones de ~370 líneas de JS
   sin tipos, sin tests, que se aplican por copy-paste en un navegador.

3. **Dos fuentes de verdad sincronizadas a mano.** `docs/n8n/README.md` mantiene
   una tabla de "bugs conocidos en el workflow vivo" — incluido "falta nodo
   turn-completed: el lock nunca se libera". El lado Fastify tiene lint +
   typecheck + tests + CI; el lado n8n tiene una checklist de "recuerda corregir
   esto en la UI". ADR-0023 quedó code-complete y siguió "pendiente de aplicar
   nodos en la UI" — cada feature termina así. El mismo ciclo de vida del
   workflow te va diciendo que algo anda mal.

4. **No existe *un* estado de diálogo — existe una federación de estados
   parciales.** Transiciones válidas en `set-stage.ts` (Fastify), cascadas en
   `TRANSITION_MACROS` (n8n), objeciones "en el prompt", escalado determinista en
   `webhook-manychat.ts`, `notify_human` en el agente, memoria en
   `n8n_chat_histories` con formato interno de LangChain. El plan de handoff lo
   dijo literalmente: *"hay dos memorias que no se hablan"*. ADR-0023 parchó la
   lectura, pero el problema de fondo persiste.

### Qué inspiró la solución

Al estudiar modelos de diálogo apareció **Rasa CALM** (Conversational AI with
Language Models). Su tesis: *el LLM entiende la conversación y emite comandos de
un vocabulario pequeño y fijo (`StartFlow`, `SetSlot`, `CancelFlow`, `Clarify`,
`HumanHandoff`…); un motor determinista ejecuta la lógica de negocio definida en
flows declarativos (YAML: collect/action/branch/link), con un dialogue stack
LIFO y patrones de reparación conversacional de primera clase
(`pattern_human_handoff`, `pattern_cannot_handle`, `pattern_continue_interrupted`,
`pattern_correction`…)*. El LLM nunca decide reglas de negocio.

Rasa CALM es de pago (Rasa Pro). La decisión es **implementar su filosofía
nosotros**, sobre LangGraph.js como runtime.

### El hallazgo clave: el sistema ya convergió hacia CALM por accidente

| Concepto CALM | Lo que ya tenemos (disperso) |
|---|---|
| Command generator (LLM emite comandos) | Structured Output del agente v3: `actions[]` con `send_content`, `change_stage`, `reply_text` |
| Flow engine determinista | Router v4.5 + `TRANSITION_MACROS` + `VALID_TRANSITIONS` en Fastify |
| Flows declarativos | `funnel_stages` + `stage_flows` + `stage_transitions_map` + cascadas hardcodeadas |
| `pattern_human_handoff` | Todo ADR-0023 + escalado Telegram, construido ad-hoc |
| `pattern_cannot_handle` | La matriz de medios por `content_class` — es exactamente este patrón |
| `pattern_continue_interrupted` | `handoff_state` + regla 8 del prompt ("no repitas, reconoce la interrupción") |
| Slots + dialogue stack | **No existe — es el hueco real.** Las "señales" del lead viven en el prompt y en `metadata` sin estructura |
| Context assembly | Build Context v6 |

Las decisiones de diseño correctas **ya se tomaron** (salida estructurada,
ejecución determinista, config en DB, matriz de política). Lo que falla es dónde
viven. El refactor no es "tirar todo y empezar de cero": es **mudar una
arquitectura que ya existe implícitamente** a un proceso tipado, testeado y
desplegable. Una mala arquitectura atrasa más que refactorizarla a una buena y
después pasar muy rápido.

---

## Sección 1 — Decisión: el motor de diálogo

### Arquitectura objetivo

```
ManyChat ──► Fastify edge (NO SE TOCA: auth, idempotencia, debounce,
             buffer, lock, persistencia, clasificación content_class)
                │ BullMQ worker
                ▼  HTTP síncrono (await)
         apps/agent  (LangGraph.js, mismo monorepo TS)
         ┌─────────────────────────────────────────────┐
         │ 1. Context Assembler  (Build Context tipado  │
         │    + testeado, una sola fuente)               │
         │ 2. Dialogue Understanding (LLM → comandos)    │
         │ 3. Flow Engine: stack + slots + flows         │
         │    declarativos del tenant (Postgres JSONB)   │
         │ 4. Repair patterns: handoff, cannot_handle,   │
         │    continue_interrupted, clarify              │
         │ 5. Action Executor (ex-Router, tipado) ──► adapters: ManyChat hoy,
         │ 6. Respuesta + persistir estado/checkpoint    │   web chat mañana
         └─────────────────────────────────────────────┘
                │ return → worker libera lock
n8n ──► queda para integraciones de back-office (Calendly glue,
        notificaciones internas, experimentos) — fuera del hot path
```

### Decisiones puntuales (y los debates que las fijaron)

**1. n8n sale del hot path conversacional — el worker llama al agente directo.**
Se descartó "n8n se lo pasa a LangGraph": si n8n queda como proxy entre Fastify
y el agente, no aporta nada y suma un punto de fallo, un salto de red y la
fragilidad de expresiones ya conocida. n8n se queda para lo que es bueno: glue
de integraciones donde la visualización aporta y la frecuencia de cambio es
baja. **Un setter de IA en producción —con man-in-the-middle, escalado, contexto
de conversaciones externas y de follow-ups— no se sostiene en n8n; n8n queda
para interacciones muy básicas.**

**2. La llamada es síncrona y eso mata la maquinaria de callbacks.** Toda la
maquinaria de `callback_url` / `callback_token` / `turn-completed` / watchdog
(ADR-0017) existe solo porque n8n es un webhook fire-and-forget. El worker hace
`await agent.runTurn()` y libera el lock él mismo en un `finally`. La clase
entera de bugs "el lock nunca se libera" muere por diseño.

**3. LangGraph.js sí, pero con rol acotado.** LangGraph **no te da CALM** — no
trae dialogue stack, ni flows declarativos, ni repair patterns. Eso lo
escribimos nosotros, y es el IP del producto (el motor agnóstico que se vende a
muchos negocios). Lo que LangGraph sí da y vale la pena: checkpointing en
Postgres (estado del grafo persistido por conversación), `interrupt()`
(human-in-the-loop nativo — el handoff se vuelve un interrupt del grafo, no una
tabla paralela), reintentos, streaming y observabilidad. **LangGraph.js, no
Python:** todo el stack es TS, se comparten los Zod schemas de `@dm-api/shared`,
el mismo CI, el mismo monorepo (`apps/agent`). Meter Python parte el repo en dos
mundos por cero beneficio — el motor de flows es interpretación de JSON, no
ciencia de datos. **Regla de oro:** la lógica de negocio vive en el intérprete
de flows (TS puro, testeable sin LangGraph); LangGraph es solo el runtime que lo
orquesta. Que mañana se pueda cambiar de runtime sin reescribir flows.

**4. "Todas las reglas en YAML" — cuidado con el inner-platform effect.** CALM
funciona porque su vocabulario es **pequeño y cerrado**: ~6 tipos de step, ~8
comandos. Si el YAML intenta expresar "cualquier llamada a API, cualquier
función, lo que sea", se termina inventando un lenguaje de programación malo
dentro de YAML, y se vuelve a tener el problema del Router pero en otro formato.
La línea correcta: los **datos** del negocio son declarativos por tenant
(etapas, transiciones, cascadas, catálogo de contenido, cadencias, matriz de
medios, keywords); los **tipos de acción** (`send_content`, `change_stage`,
`reply_text`, `notify_human`, `call_api`) son código tipado y agregar uno nuevo
es un PR normal. Es exactamente lo que hace Rasa: el flow YAML referencia
`action: nombre`, pero la action es código. Los flows del tenant van en
**Postgres JSONB versionado** (tabla `flow_definitions` con columna de versión —
un lead a mitad de conversación no se rompe al editar), no archivos YAML en
disco: somos multi-tenant, ya existe el patrón `tenant.config`, y habilita
edición desde `/settings`. YAML en repo solo como plantilla seed del "setter
genérico".

**5. Followups pasan por el mismo cerebro.** Hoy el followup-runner escribe
directo en `n8n_chat_histories` (ADR-0012) para que el agente "se entere" — otro
síntoma de las dos memorias. En el modelo nuevo, un followup es simplemente **un
turno iniciado por el sistema** que entra al mismo motor con el mismo estado.
Eso resuelve de raíz "dominar el contexto de los follow-ups que se le están
entregando al lead". Lo mismo para el contexto externo (Calendly, web, actividad
IG): se vuelven **eventos que mutan slots** del estado de diálogo, y el Context
Assembler los ve igual que todo lo demás. La "consciencia de lo de fuera" deja
de ser N parches (ADR-0012, 0013, 0023, Calendly feedback…) y pasa a ser una
propiedad del modelo: **hay un solo estado**.

**6. Unificación del escalado.** Hoy hay dos caminos de escalado que no se
conocen (keyword/media en Fastify, `notify_human` en el agente) y ADR-0023 los
re-cose a posteriori vía `handoff_state`. En el motor nuevo, la detección
determinista de Fastify se vuelve un **comando generado sin LLM**
(`HumanHandoff(reason=audio)`) que entra al mismo motor que los comandos del
LLM. Un solo camino, el stack se entera solo, y la regla 8 del prompt se vuelve
innecesaria como parche.

**7. El dialogue stack es la pieza genuinamente nueva.** Hoy una digresión
("¿cuánto cuesta?" en mitad de MS) no tiene representación — se resuelve "en el
prompt" y se pierde. Con stack, la objeción es un flow que se apila, se resuelve
y hace pop de vuelta al funnel (`pattern_continue_interrupted`).

---

## Sección 2 — El modelo de cuatro capas: qué es agnóstico y qué no

### Mecanismo vs. política

El error conceptual a evitar: creer que "agnóstico" significa "sin lógica de
negocio". Significa **separar mecanismo de política**. El round-robin ponderado
es el ejemplo perfecto: "selección ponderada entre variantes de un grupo de
contenido" **no** es lógica de negocio de Quantum Creators — es un mecanismo
genérico de experimentación de contenido. Lo que sí es negocio de QC: *que
existan 4 hooks de video, sus pesos, y en qué etapa se usan*. Un bufete de
abogados puede usar el mismo mecanismo para rotar 3 PDFs de presentación… o no
usarlo (un grupo con una sola variante degrada a "envía esto"). El mecanismo
vive en la plataforma; los datos que lo alimentan viven en el tenant.

La prueba de fuego para cada pieza:

> **¿Esto cambia si mañana llega el bufete?** Si cambia el *código*, es una
> fuga. Si solo cambian *filas en Postgres*, está bien diseñado.

### Las cuatro capas

1. **Plataforma** (idéntica para todos, jamás se toca por tenant): edge Fastify
   completo, motor de diálogo (stack, slots, comandos, repair patterns),
   handoff/man-in-the-middle, clasificación de medios, transcripción futura,
   checkpoints, audit trail, harness de replay/eval, multi-tenancy.

2. **Mecanismos parametrizados** (código genérico + datos del tenant): máquina
   de etapas con N etapas arbitrarias, transiciones + cascadas, catálogo de
   contenido con grupos/pesos, cadencias, matriz de medios, keywords, schema de
   slots.

3. **Conectores** (código, pero registrados y reutilizables — nunca forks por
   tenant): aquí va el "hay que llamar a otras APIs". El patrón es un **action
   registry**: la plataforma expone tipos de acción (`send_content`,
   `reply_text`, `change_stage`, `notify_human`, `schedule_followup`,
   `http_request` declarativo para casos simples) y conectores con nombre
   (`calendly`, mañana `clio` para abogados, `close_crm`). El flow del tenant
   los referencia por nombre con su config; el conector es código tipado y
   testeado que *cualquier* tenant puede usar. Es el modelo de custom actions de
   Rasa: el YAML dice `action: check_conflicts`, el código vive en el registry.
   Cuando un tenant necesite algo que no existe, se escribe **una vez como
   conector de plataforma**, no como parche del tenant.

4. **Política pura** (solo filas en Postgres, editable desde el dashboard):
   etapas, transiciones, flows, contenido, pesos, persona, keywords, matriz,
   URLs, credenciales de integraciones.

### El test del bufete, componente por componente

| Componente actual | ¿Sobrevive al bufete? | Capa |
|---|---|---|
| Debounce, idempotencia, locks, buffer, BullMQ | Intacto | Plataforma |
| Clasificación `content_class` + matriz de medios | Intacto (la *política* por clase ya es `tenant.config.media_policy` — ADR-0023 lo hizo bien) | Mecanismo + datos |
| Keywords de escalado | Intacto (ya es `tenant.config.notification_keywords`) | Datos |
| Man-in-the-middle, pausa, handoff_state, notas de resolución | Intacto — igual para abogados | Plataforma |
| Transcripción futura de audio | Intacto (cambio de política en la matriz) | Plataforma |
| Máquina de etapas A/MS/B/C/D | **Fuga**: `VALID_TRANSITIONS` y los `reason` de descalificación (`no_money`, `geographic`…) hardcodeados en `set-stage.ts`. El bufete necesita `intake → conflict_check → consulta → retained` y razones como `conflicto_de_interés`, `jurisdicción_equivocada` | Debe ser datos |
| Cascadas (`TRANSITION_MACROS`) | **Fuga total** (slugs QC en el Router) → flows declarativos por tenant | Debe ser datos |
| Selección ponderada de variantes | Mecanismo OK; pesos y grupos ya están en `stage_flows` | Mecanismo + datos |
| Cadencias de followup | OK (`followup_templates` en DB) | Datos |
| System prompt | **Fuga**: un bloque monolítico mezcla la persona "Alex" (negocio) con las reglas de operación del agente (plataforma) | Hay que partirlo |
| Calendly | **Fuga conceptual**: es *la* integración de QC cableada como caso especial (`calendly_url`, macro `B->C`) | Debe ser conector |
| Dashboard Kanban / settings | A verificar — si las columnas del Kanban asumen A/MS/B/C/D, es fuga; debe renderizar desde `funnel_stages` | Mecanismo + datos |

Patrón notable: **las piezas más recientes (ADR-0023) ya están bien** — matriz
por clase con override en config, keywords editables en `/settings`. Las fugas
están en las piezas viejas del MVP.

### Piezas nuevas que destapa este análisis

**El prompt se parte en dos.** Esqueleto de plataforma (cómo emitir comandos,
cómo comportarse ante handoff_state, reglas de repair — igual para todos) +
bloque de persona/negocio del tenant ("eres Alex, tono seco…" / "eres la
asistente del bufete Gómez, tono formal…"). Hoy son indistinguibles en el Set
node, y por eso cada ajuste de Alex arriesga romper las reglas operativas.

**Lo que el humano escribe por la app nativa o la web** no es una feature
aparte: es un tipo de evento del channel adapter (los *echoes* — mensajes
salientes no emitidos por el bot). Entra al motor como `human_turn`, muta el
estado de diálogo, y el agente lo ve en su memoria igual que todo lo demás. Es
la generalización natural del `handoff_state`: en vez de "el agente sabe *que*
intervino un humano", pasa a saber *qué dijo*.

**Dashboard y CRM se desacoplan con eventos de dominio.** El motor emite
`lead.stage_changed`, `conversation.escalated`, `content.sent`,
`lead.disqualified`… El dashboard es un consumidor (y se vuelve data-driven:
pinta las columnas que `funnel_stages` diga). Un conector de CRM es otro
consumidor: Close para QC, Clio para el bufete. La plataforma no sabe qué CRM
existe — solo publica hechos.

### Sobre "diseñé un setter casi solo para Alex"

Era el camino correcto a medias: la abstracción prematura es el error simétrico
y más caro — un motor genérico diseñado contra cero clientes reales adivina mal
qué necesita ser configurable. QC no fue un desvío: es la *instancia* de la que
ahora se extrae el schema. La regla de los refactors buenos es **extraer, no
inventar**: cada primitiva del motor (etapa, cascada, conector, slot) debe
justificarse con algo que QC ya hace hoy, más el contraejemplo del bufete como
test de diseño.

---

## Sección 3 — El tenant sintético: criterio de aceptación de la agnosticidad

Se define en papel un segundo tenant ficticio — **el bufete** — y se usa como
test de aceptación permanente del motor:

> **Si onboardear al bufete requiere un PR fuera del registry de conectores, la
> abstracción tiene una fuga.**

### Definición del tenant sintético "Bufete Gómez & Asociados"

| Dimensión | Quantum Creators (real) | Bufete (sintético) |
|---|---|---|
| Etapas | `A → MS → B → C → D` | `intake → conflict_check → consulta_agendada → retained` |
| Razones de descalificación | `no_money`, `not_interested`, `geographic`, `no_quality`, `fake_account` | `conflicto_de_interés`, `jurisdicción_equivocada`, `materia_no_practicada`, `no_puede_pagar_anticipo` |
| Contenido | 4 video hooks ponderados, audio + VSL, prueba social | 1 PDF de presentación (grupo de 1 variante — el mecanismo degrada), sin VSL |
| Cascadas | `A->MS` envía audio+VSL y avanza a B | `intake->conflict_check` dispara conector `check_conflicts` y espera resultado |
| Conectores | `calendly`, futuro `close_crm` | `check_conflicts` (API ficticia de verificación de conflictos), agenda propia (no Calendly) |
| Persona | "Alex", tono seco, cero admisión de IA | Asistente formal del bufete, trato de usted, disclaimers legales |
| Escalado | audio/keywords → Telegram | igual mecanismo, otras keywords ("demanda", "urgente", "plazo vence") |
| Canal | Instagram vía ManyChat | Instagram hoy; WhatsApp como prueba futura del channel adapter |
| Followups | cadencia 24h/48h/72h, 8 intentos | cadencia semanal, 3 intentos (solo cambian filas) |

### Checklist de onboarding — el "done" de la agnosticidad

El onboarding de cualquier tenant debe ser **100% datos**:

- [ ] Crear fila de tenant
- [ ] Definir etapas, transiciones y razones de descalificación
- [ ] Definir flows declarativos (cascadas, collects, branches)
- [ ] Cargar catálogo de contenido (grupos, variantes, pesos)
- [ ] Escribir bloque de persona del prompt
- [ ] Configurar keywords + matriz de medios
- [ ] Configurar cadencias de followup
- [ ] Conectar canal (credenciales del adapter)
- [ ] Configurar conectores existentes (o encargar uno nuevo **al registry**, nunca un fork)
- [ ] **Cero código fuera del registry de conectores**

La Fase 1 del plan (el contrato) se hace **contra los dos tenants a la vez**:
QC real + bufete de papel. Si el vocabulario de flows expresa ambos, es
agnóstico de verdad; si no, se descubre en papel y no en producción.

---

## Plan por fases (estrangulador — nunca big-bang, hay leads vivos)

- **Fase 0 — Cerrar lo abierto y congelar.** Shippear ADR-0023 como está
  (aplicar los 4 cambios de UI de n8n una última vez — el valor del handoff
  awareness se necesita ya y el lado TS sobrevive intacto). Freeze de features
  en `agent-run`/n8n: solo hotfixes.
- **Fase 1 — El contrato (2-3 días).** Sin código de runtime: Zod schemas del
  vocabulario de comandos, del flow declarativo (steps `collect`/`action`/
  `branch`/`link` + guards), del estado de diálogo (stack + slots), tablas
  `dialogue_states` y `flow_definitions` (versionada). Traducir
  `TRANSITION_MACROS` + `VALID_TRANSITIONS` + `stages.md` a una primera
  definición de flow de QC **y** del bufete sintético.
- **Fase 2 — `apps/agent` (1-1.5 semanas).** LangGraph.js: grafo
  `assemble_context → understand → flow_engine → execute_actions → respond`,
  checkpointer Postgres. Portar Build Context v6 como módulo tipado con tests
  unitarios (`pickWeighted`, `collapseVariantGroups`, el bug de variantes v5 —
  todo testeable por fin). Portar Router como Action Executor con adapter de
  ManyChat. Memoria propia (tabla de turnos, no el formato interno de LangChain).
- **Fase 3 — Shadow mode (3-5 días con tráfico real).**
  `tenant.config.engine = 'n8n' | 'agent'`. El worker despacha a ambos: n8n
  responde al lead, el agente nuevo corre en dry-run loggeando sus comandos sin
  enviar nada. Comparación turno a turno. Harness de replay con `messages_raw`
  como dataset de eval (conectar con `12_SUCCESS_METRICS_AND_EVAL`).
- **Fase 4 — Cutover por tenant.** Flip del flag para QC; n8n agent-run de
  fallback frío una semana; luego se archiva. Se elimina la maquinaria
  callback/turn-completed/watchdog del camino nuevo.
- **Fase 5 — Followups al motor.** BullMQ repeatable jobs reemplazan al
  followup-runner; cada followup es un turno system-initiated por el mismo
  grafo. Muere ADR-0012.
- **Fase 6 — Lo que se desbloquea.** Adapter de web chat (segundo canal =
  segundo adapter, mismo cerebro), eventos externos como slots (Calendly, IG
  context, echoes de humano), transcripción/visión como cambio de política en la
  matriz (ADR-0023 lo dejó listo), onboarding de tenant nuevo = checklist de la
  Sección 3.

**Expectativa honesta de esfuerzo:** paridad real (turno conversacional +
cascadas + followups + handoff + memoria migrada) son **2-3 semanas** de trabajo
serio, no 2-3 días. Subestimar un refactor es la forma clásica de abandonarlo a
la mitad y quedarse con *tres* arquitecturas conviviendo. Cada fase entrega
valor y el sistema viejo sigue corriendo hasta que el nuevo demuestre paridad
con tráfico real.

---

## Alternativas descartadas

- **Seguir evolucionando el agente en n8n:** cada feature requiere aplicar
  nodos a mano en la UI, sin tipos ni tests ni rollback atómico; el Router ya
  acumuló 9 versiones peleando contra la plataforma. Descartada — n8n queda para
  interacciones básicas y back-office.
- **Rasa CALM (Rasa Pro):** la filosofía es exactamente la correcta, pero es de
  pago y meteria un runtime Python + DSL externo en medio del stack. Se adoptan
  sus patrones de diseño (command generator, flows declarativos, dialogue stack,
  repair patterns), implementados en TS propio.
- **LangGraph Python:** parte el monorepo en dos mundos (CI, schemas, tipos) por
  cero beneficio — el motor de flows es interpretación de JSON, no ciencia de
  datos.
- **n8n como proxy hacia LangGraph:** no aporta nada en el hot path; suma
  latencia, un punto de fallo y la fragilidad de expresiones conocida.
- **DSL genérico "todo en YAML" (cualquier API, cualquier función):**
  inner-platform effect — se reinventa el problema del Router en otro formato.
  Vocabulario cerrado + action registry en código.

## Consecuencias

**Positivas:**
- Un solo estado de diálogo; "las dos memorias que no se hablan" desaparece.
- Lógica de negocio = filas en Postgres; onboarding de tenant sin código.
- Todo el cerebro pasa a tener tipos, tests y CI; muere el copy-paste a la UI.
- La llamada síncrona elimina la maquinaria callback/lock-watchdog.
- Escalado unificado (determinista y LLM emiten los mismos comandos).
- Followups y eventos externos entran al mismo cerebro: consciencia total.
- Multi-canal (web, WhatsApp) = nuevos adapters, mismo motor.

**Negativas / riesgos:**
- **Regresión de comportamiento conversacional es el riesgo #1**, no el técnico:
  el prompt v9 + Claude en n8n tiene un comportamiento calibrado con Alex.
  Mitigación obligatoria: shadow mode + replay de transcripts reales.
- LangGraph.js tiene comunidad más chica que la versión Python; los patrones
  usados serán mainstream, no exóticos — riesgo bajo.
- Disciplina de alcance: el motor de flows tienta a generalizarse
  infinitamente. Vocabulario cerrado; se extiende solo cuando un caso real lo
  exige dos veces.
- Dependencia nueva (`@langchain/langgraph`) — este ADR es el requisito de
  CLAUDE.md para agregarla.

## ADRs relacionados

- ADR-0008 (inyección dinámica) — el principio multi-tenant se conserva; la
  implementación se muda del Router/n8n al flow engine.
- ADR-0009 (agent-run en n8n) — superseded al completar Fase 4.
- ADR-0012 (followups en chat memory) — superseded al completar Fase 5.
- ADR-0013 (contexto dual) — el Context Assembler hereda y tipa este diseño.
- ADR-0017 (watchdog) — innecesario en el camino síncrono.
- ADR-0023 (handoff + taxonomía) — la matriz y el handoff_state se conservan
  como mecanismos de plataforma; la regla 8 del prompt se reemplaza por
  `pattern_continue_interrupted`.
