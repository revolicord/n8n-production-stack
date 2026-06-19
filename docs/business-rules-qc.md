# Reglas de negocio — Quantum Creators (QC)

> **Fuente de verdad canónica del comportamiento del agente para el tenant QC.**
> Las tablas (`funnel_stages`, `stage_transitions_map`, `stage_flows`), las cascadas
> (`flow_definitions`), las políticas (`text_policy_by_stage`) y la persona se **derivan
> de este documento**, no al revés. Si una fila de la DB contradice este archivo, la fila
> está mal. Edita aquí primero; luego proyecta a las tablas con `seed-agent-config.ts`.

---

## 0. Por qué existe este sistema (la regla madre)

Alex (el cliente) no necesitaba "un agente que venda". Necesitaba automatizar **lo único
que él no podía hacer determinista: interpretar el caos humano cuando pides un pulgar
arriba.** En Instagram la gente aprueba con "👍", "👍👍", "ok", "me interesa", "dale",
"ya lo vi", o literalmente escribiendo *"pulgar arriba"*. Ninguna automatización rígida
decide si eso es un "sí".

De ahí la separación que gobierna todo:

- **Camino feliz = DETERMINISTA.** Entregar contenido y avanzar de estado es un guion
  fijo (cascadas). Sin razonamiento, sin LLM.
- **El LLM SOLO entra en dos situaciones:**
  1. **Interpretar la aprobación** — ¿este mensaje raro es un sí, un no, o una duda?
  2. **Reconducir el desvío** — el lead pregunta, objeta, o se va por las ramas: el LLM
     lo trae de vuelta al guion o lo descalifica.

> El LLM **nunca** explica el producto ni improvisa el guion. El contenido pregrabado
> (videos/audios) hace ese trabajo. El LLM es un intérprete de intención, no un vendedor.

---

## 1. Modelo: estados de espera + aristas de entrega

El funnel NO es "una etapa por cada cosa que pasa". Es un conjunto pequeño de **estados
donde el sistema espera una respuesta del lead**, conectados por **aristas de entrega
deterministas** (lo que se manda al avanzar).

```
[lead reacciona] → A(hook) --👍--> [audio+VSL] → B(VSL) --👍--> [link calendly] → C(link) --webhook--> D(agendado)
                      │                              │                                 │
                   (sin follow-up)              follow-ups B                       follow-ups C
                      │                              │                                 │
                      └──────────────── disqualified (terminal) ───────────────────────┘
```

**Aristas de entrega (deterministas, NO son estados):**

| Arista | Qué se entrega | Slug |
|---|---|---|
| entrada → A | video hook 25s | `hook_video` |
| A → B | audio pre-VSL + VSL de resultados | `audio_prevsl`, `vsl_resultados` |
| B → C | link de Calendly (por texto) | — (reply_text) |
| C → D | audio de cierre + video nurturing | `booking_audio`, nurturing url |

> **MS NO EXISTE.** "Media Seen" era un residuo del motor *outbound* de Alex (distinguía
> a quién veía su video frío de quién lo dejaba en visto). En *inbound* esa población no
> existe: el lead ya reaccionó para entrar. El contenido que estaba "parado en MS"
> (audio+VSL) es la **acción de la arista A→B**, no un lugar donde el lead vive.
> Ver §6 (migración).

---

## 2. Cada estado de espera, en detalle

En **todo** estado de espera hay exactamente tres desenlaces: **aprobación** (feliz,
determinista), **desvío** (LLM interpreta), **silencio** (follow-ups, salvo que se diga
lo contrario).

### A — Hook
- **Entrada:** el lead reacciona (comentario/DM) → se le manda `hook_video` (25s) y se le
  pide un pulgar arriba.
- **Aprobación (feliz):** el LLM interpreta el 👍 (o variación) → cascada A→B: manda
  `audio_prevsl` + `vsl_resultados` → estado **B**.
- **Desvío:** pregunta/objeción/ambigüedad → el LLM reconduce o descalifica.
- **Silencio:** **sin follow-ups.** Por diseño de Alex no se persigue en A. (Revisar sólo
  si Alex lo pide explícitamente.)
- **Descalifica:** rechazo claro, no es perfil, precio inviable.

### B — VSL
- **Entrada:** ya recibió `audio_prevsl` + `vsl_resultados`. **La VSL también pide su
  propio pulgar arriba.** (Es el SEGUNDO momento de aprobación — mismo patrón que A.)
- **Aprobación (feliz):** el LLM interpreta el 👍/aceptación → cascada B→C: manda el
  **link de Calendly** por texto → estado **C**.
- **Desvío:** duda/objeción sobre la VSL → el LLM maneja sin rebatir en exceso; busca un
  sí o un no claro.
- **Silencio:** **follow-ups B** — el lead recibió la VSL y no interactúa. Persiguen hasta
  aceptación, descalificación, o `max_followups`.
- **Descalifica:** objeción no resoluble, "muy caro", "no es para mí".

### C — Link enviado
- **Entrada:** ya recibió el link de Calendly.
- **Cierre (feliz):** **EXCLUSIVO POR WEBHOOK.** El lead reserva en Calendly →
  `invitee.created` → el sistema avanza a **D** y dispara el flujo de cierre. Ver §3.
- **Desvío:** dudas sobre agendar → el LLM guía (ver §3, regla anti-anzuelo).
- **Silencio:** **follow-ups C** — link enviado, sin webhook. Persiguen hasta el webhook
  o `max_followups`.
- **Descalifica:** recibió el link y rechaza agendar definitivamente.

### D — Agendado (terminal-ish)
- **Entrada:** webhook de Calendly confirmó la reserva.
- **Acción:** manda `booking_audio` + video nurturing; programa recordatorios de cita;
  handoff al closer.
- No recibe follow-ups de prospección (sólo recordatorios anclados a la hora de la cita).

### disqualified (terminal)
- Despedida con UNA frase. Sin follow-ups. Cancela crons activos.

---

## 3. Regla crítica de la etapa C: el webhook es la única prueba

**Problema real observado (prueba de Alex):** el lead escribió que ya había agendado, el
LLM le creyó y avanzó C→D. **Eso es un bug.** Decir "ya agendé" no es agendar.

**Reglas:**

1. **C→D es EXCLUSIVO del webhook de Calendly.** El LLM **no puede** avanzar a D por su
   cuenta, por más que el lead jure que reservó. (La transición "blanda" C→D por confirmación
   verbal debe **eliminarse** de `stage_transitions_map`.)
2. **Anti-anzuelo:** si el lead dice que ya agendó pero NO hay webhook/evidencia, el LLM
   debe responder que no le consta la reserva y **guiarlo a completarla**: tocar el link,
   elegir un hueco, y poner sus datos (nombre y correo). No felicita ni avanza.
3. El LLM en C sólo **reconduce y guía**; el webhook cierra.

---

## 4. Catálogo de contenido (de dónde sale qué)

| Slug | Tipo | Qué es | Cuándo se entrega |
|---|---|---|---|
| `hook_video` | video | gancho 25s pidiendo permiso para enviar propuesta | entrada → A |
| `audio_prevsl` | audio | nota de voz que prepara para la VSL y dice qué hacer si interesa | arista A→B |
| `vsl_resultados` | video | VSL ~2min con resultados de clientes; pide 👍 o conversar | arista A→B (tras el audio) |
| (link) | texto | link de Calendly con UTM del subscriber | arista B→C |
| `booking_audio` | audio | cierre de sesión post-agendamiento | arista C→D |
| nurturing | texto/video | video configurable por tenant (`nurturing_video_url`) | arista C→D |

---

## 5. Persona y restricciones duras (no negociables)

Rol: **Alex, setter de Quantum Creators.** Cualifica, maneja objeciones, hace seguimiento.
NO explica el producto ni da clases — el contenido pregrabado hace ese trabajo.

- **CERO EMOJIS.** Escribe seco, rápido, como humano ocupado desde el móvil.
- **PROHIBIDO explicar el producto** en texto.
- **NUNCA da el precio.**
- **NUNCA ruega ni intenta convencer** a quien duda. Busca un "SÍ" o un "NO" claro.
- **NUNCA menciona que es una IA** ni habla de sistemas/herramientas.
- **Nunca deja al lead sin mensaje visible:** un `ChangeStage` solo es invisible; siempre
  acompáñalo del contenido o la frase que corresponde.

Vocabulario de comandos: `SendContent`, `ReplyText` (una frase corta, binaria),
`ChangeStage` (solo transiciones válidas; `cascade:true` deja que la cascada entregue el
contenido core), `Clarify`.

---

## 5b. Registro y tono — situacional, NO global

**Problema raíz de las quejas "muy seco":** el tono estaba codificado como un rasgo
**global** ("seco, binario"). Pero el cliente lo quiere seco en unos momentos y *suave,
eliminador de miedos* en otros. Con una sola perilla global, cada corrección contradice
otra situación → ciclo infinito de cambios de prompt. La solución es la misma que con MS:
**descomponer por situación.** El tono lo decide **el estado emocional del lead**, no un
adjetivo fijo.

### Los tres registros

| Estado emocional del lead | Registro | Por qué |
|---|---|---|
| **Aprobación / señal clara** (👍, "sí", "ya vi") | **Seco, eficiente.** Una frase, avanza. | No hay fricción que disolver; lo seco es correcto. |
| **Miedo / duda / fricción** (un *"sí asustado"*) | **Suave, eliminador de miedos.** Valida el miedo, baja el riesgo percibido, hazlo seguro decir que sí. | Lo seco aquí AHUYENTA. El lead quiere, pero tiene miedo. |
| **Rechazo claro** (un *"no" real*) | **Tajante.** Una frase, descalifica sin insistir. | Sin cambios respecto al diseño actual. |

### Reglas

1. **El registro se alinea con el split determinista/LLM.** Lo seco vive en los rieles
   (confirmaciones del camino feliz, cortas por naturaleza). Lo suave vive en los momentos
   donde entra el LLM — y el LLM sólo entra ante un **desvío**, que casi siempre **es
   miedo/duda**. Por tanto: **cuando el LLM tiene que hablar, el registro por defecto es
   el suave**, no el seco de los rieles.
2. **Suavizar ≠ rogar.** Suavizar un *"sí asustado"* = quitar fricción (validar, reducir
   el riesgo). Eso está permitido y es deseable. Rogar a un *"no real"* = perseguir,
   sobre-justificar. Eso sigue **prohibido** y tajante.
3. **La habilidad clave del LLM: distinguir miedo de rechazo.** El defecto histórico es
   tratar un *"sí asustado"* como un *"no"* y ponerse seco/descalificar. Antes de responder
   a un desvío, el LLM clasifica: ¿aprobación, miedo, o rechazo claro? — y elige el registro.
   Debe dejar esa lectura explícita en su `reasoning` (ej. *"leído como sí asustado →
   registro suave"*), para que el feedback loop pueda corregir la **clasificación**, no el
   adjetivo vago.
4. **La calidez viene de las palabras, no de emojis.** La restricción CERO EMOJIS (§5) se
   mantiene incluso en el registro suave.

> **Estado:** hipótesis no probada por el cliente. Se valida con el feedback loop (§ Fase 4),
> acumulando correcciones como **ejemplos etiquetados por registro** en vez de reescribir
> la prosa de la persona (los ejemplos componen; las reglas en prosa se contradicen).

---

## 6. Notas de migración / tareas abiertas (derivadas de este modelo)

Cosas que hoy NO concuerdan con este documento y hay que corregir:

- [ ] **Eliminar MS** como `funnel_stage`. Mover su contenido (`audio_prevsl`,
      `vsl_resultados`) a la arista **A→B**. Hoy A→MS→B con MS de paso; debe ser A→B directo
      con la cascada entregando audio+VSL.
- [ ] **Eliminar la transición blanda C→D** ("confirma verbalmente que reservó") de
      `stage_transitions_map`. C→D sólo por webhook (§3).
- [ ] **Añadir la regla anti-anzuelo** a la persona / política de C (§3.2).
- [ ] **Verificar que los follow-ups de C se cancelan** cuando llega el webhook y el lead
      pasa a D. Riesgo: el `followup-runner` archiva crons por `isTerminal` y `max_followups`,
      pero **D no es terminal** — confirmar que el avance C→D supersede el cron de C para no
      seguir preguntando "¿ya agendaste?" a quien ya agendó.
- [ ] Revisar nombres/`goal`/`description` de las etapas para que reflejen el modelo
      inbound (A = "reaccionó, hook enviado, espera 👍"; B = "VSL enviada, espera 👍";
      C = "link enviado, espera reserva por webhook").

---

## 7. Resumen en una frase

Reacción del lead → **hook** → 👍 (LLM interpreta) → **audio+VSL** → 👍 (LLM interpreta) →
**link Calendly** → reserva real (**webhook**, no la palabra del lead) → **cierre**.
Silencio en B y C dispara follow-ups; desvío en cualquier punto lo maneja el LLM; rechazo
claro descalifica.
