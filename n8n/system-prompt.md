# System Prompt del Agente

> **El prompt de producción vive en [`prompts/setter-v1.md`](./prompts/setter-v1.md).**
> Este documento solo explica *cómo* se carga y se inyecta. El prompt en sí no se duplica aquí.

---

## Dónde vive el prompt

- **Fuente versionada:** `n8n/prompts/setter-v1.md` (en git). Es la fuente de verdad.
- **En ejecución:** el bloque del prompt se copia al Set node `System Prompt` del workflow de n8n (ver `nodes/00c-system-prompt.md`).
- El nodo `Build Context` lo lee de ese Set node y le anexa el bloque `# CONTEXTO` dinámico en cada turno.

Si el Set node está vacío o no existe, `Build Context` usa un fallback mínimo (ver `nodes/01-build-context.md`).

> **Por qué no en DB:** iterar el prompt durante prompt engineering requiere edición rápida. Tenerlo en un Set node permite editar en la UI de n8n y activar el workflow en segundos, sin SQL ni re-deploy. La fuente de verdad versionada sigue siendo el `.md` en git.

---

## Cómo se construye el prompt final

```
systemPrompt = <Set node "System Prompt".staticPrompt>  +  "\n\n# CONTEXTO\n"  +  <bloque dinámico>
```

El bloque dinámico se construye en `Build Context` con los datos del payload del turno:

```
La persona se llama: {subscriberName}
Etapa actual del lead: {currentStage}
Última vez activa en Instagram: {lastSeen}
Última interacción contigo: {lastInteraction}
Señales detectadas en turnos anteriores: {signals}
Link de Calendly para enviar en etapa B→C: {calendlyUrl}

CONTENIDO DISPONIBLE para esta etapa (usa trigger_manychat_flow con el flow_name exacto):
- flow_name: "content20260511152354_558165" — Vídeo de enganche de 25 s — primer contacto
```

Las variables que falten simplemente no se incluyen — el prompt degrada con elegancia.
Ver el contrato completo de inyección en `prompts/setter-v1.md`.

---

## Sección dinámica de flows (`CONTENIDO DISPONIBLE`)

Se inyecta a partir de `tenant.config.flows_by_stage[etapaActual]`. Formato de cada línea:

```
- flow_name: "<ns de ManyChat>" — <description>
```

El `flow_name` que ve el LLM **es el `ns` de ManyChat directamente** — esto evita un paso de lookup
en n8n y el modelo lo usa como string exacto. Si no hay flows para la etapa, la lista dice
`(no hay contenido nuevo para enviar en esta etapa)`.

---

## Notas sobre tool calling con Claude Sonnet 4.6

- El modelo soporta tool calling nativo vía la API de Anthropic cuando las tools están conectadas en n8n como `ai_tool`.
- Si el modelo emite `<function=name>{...}` como texto plano, n8n no está pasando las tools al modelo. Verificar que `trigger_manychat_flow` y `set_stage` están conectadas al nodo AI Agent con tipo `ai_tool`.
- El prompt explícito sobre cómo y cuándo usar cada tool mejora la adherencia.
- El `ns` no se adivina — se inyecta desde `stage_flows` en la DB (ver `nodes/01-build-context.md`). El JSON Schema de `trigger_manychat_flow` refuerza con `pattern: "^content[0-9]{14}_[0-9]+$"`.
- Sonnet 4.6 tiene adherencia alta a copiar strings literales en tool calls; es el fallback por defecto si un modelo de gama media (llama, gpt-4o-mini) falla en pruebas.
