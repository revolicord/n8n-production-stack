# Feedback loop de afinamiento del agente (Fase 4)

Cómo convergir el comportamiento del agente hacia lo que quiere el cliente, sabiendo que
**el cliente no sabe pedirlo a priori pero reconoce lo que no quiere cuando lo ve**.

El loop convierte conversaciones reales + correcciones del cliente en cambios **enrutados
a la capa correcta** (persona/registro, transición, política, contenido, cascada), no en
parches eternos al prompt.

## Las piezas

| Pieza | Qué es |
|---|---|
| `docs/business-rules-qc.md` | Fuente de verdad canónica del comportamiento (estados, aristas, registros). |
| `export-conversation` (script) | Exporta una conversación a markdown anotable + el bundle de reglas del tenant. |
| `expert-system-prompt.md` | System prompt de la IA experta (prompting + IG setting + CALM). |
| `agent_turn_traces` | Fuente de datos: lead dijo / razonó / decidió / respondió, por turno. |
| `replay` / modo shadow | Re-corre la conversación con la config nueva para validar antes de tocar a un lead real. |

## El ciclo

```
1. EXPORTAR    make export-conversation CONV=<conversation_id>
                 → agent-tuning-out/<conv>.conversation.md   (transcript anotable)
                 → agent-tuning-out/<tenant>.bundle.md         (corpus de reglas)

2. ANOTAR      El cliente abre el .conversation.md y, en los turnos que NO le gustaron,
                 rellena el bloque FEEDBACK: veredicto=mal, respuesta_deseada, por_que.

3. EVALUAR     Nueva sesión de Claude con expert-system-prompt.md como system prompt.
                 Adjuntar: el bundle + el/los conversation.md anotados + business-rules-qc.md.
                 → Devuelve: auditoría de consistencia + diagnóstico por turno +
                   cambios etiquetados por capa + ejemplos few-shot + riesgos.

4. APLICAR     El humano aplica el cambio en su capa:
                 - persona/registro → editar persona-<slug>.md  (o añadir ejemplo few-shot)
                 - transición/política/contenido → SQL o panel /settings
                 - flow/cascada → flows-<slug>.json
                 Luego: make seed-agent-config SLUG=<slug>   (empuja a la DB)

5. VALIDAR     Replay/shadow de la(s) misma(s) conversación(es): ¿la respuesta nueva se
                 acerca a la deseada sin romper turnos que estaban "ok"?

6. REPETIR     Hasta converger. Los ejemplos few-shot anotados se acumulan como GOLDEN SET
                 de regresión: afinar una cosa no debe romper otra.
```

## Por qué funciona (las dos ideas clave)

1. **Enrutar por capa, no parchear el prompt.** En este stack un "respondió mal" suele ser
   config (transición, política, contenido), no wording. La IA experta clasifica la causa
   raíz y manda el fix a su capa. Ver la tabla en `expert-system-prompt.md`.

2. **Acumular ejemplos, no reescribir prosa.** El tono/registro se calibra con ejemplos
   etiquetados (`situación → respuesta deseada [registro]`), no con más adjetivos en la
   persona. Las reglas en prosa se contradicen entre sí (el ciclo infinito); los ejemplos
   componen. El `reasoning` que guarda cada traza permite corregir la **clasificación** del
   lead ("era un sí asustado, no un no"), que es la raíz de la mayoría de las quejas de tono.

## Requisitos

- El tenant debe correr con `trace_level=full` para que el bundle incluya `reasoning` y
  `prompt` (ver `docs/langsmith-langgraph-observabilidad.md`).
- `dm-api:local` debe estar rebuildeada con el script compilado (`make export-conversation`
  corre `dist/scripts/export-conversation.js`).
