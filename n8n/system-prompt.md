# System Prompt del Agente

> **El prompt de producción vive en [`prompts/setter-v1.md`](./prompts/setter-v1.md).**
> Este documento solo explica *cómo* se carga y se inyecta. El prompt en sí no se duplica aquí.

---

## Dónde vive el prompt

- **Fuente versionada:** `n8n/prompts/setter-v1.md` (en git). Es la fuente de verdad.
- **En ejecución:** el bloque del prompt se copia a `tenants.config.system_prompt` del tenant Quantum Creators.
- El nodo `Build Context` lo lee de ahí y le anexa el bloque `# CONTEXTO` dinámico en cada turno.

Si `tenants.config.system_prompt` está vacío, `Build Context` usa un fallback mínimo (ver `nodes/01-build-context.md`).

---

## Cómo se construye el prompt final

```
systemPrompt = <tenants.config.system_prompt>  +  "\n\n# CONTEXTO\n"  +  <bloque dinámico>
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

Se inyecta desde el registro `stage_flows` de la etapa actual (vía `Get Stage Config` → `Build Context`; ver [`../docs/onboarding/09-flow-registry-manychat.md`](../docs/onboarding/09-flow-registry-manychat.md)). Formato de cada línea:

```
- flow_name: "<ns de ManyChat>" — <description>
```

El `flow_name` que ve el LLM **es el `ns` de ManyChat directamente** — esto evita un paso de lookup
en n8n y el modelo lo usa como string exacto. Si no hay flows para la etapa, la lista dice
`(no hay contenido nuevo para enviar en esta etapa)`.

---

## Notas sobre tool calling

> El modelo en uso es **Claude Sonnet 4.6**. El doc del nodo `nodes/03-groq-chat-model.md` conserva el nombre histórico (Groq) y queda fuera del alcance de este refactor — reconciliar por separado. Ver [`../docs/status.md`](../docs/status.md).

- El modelo soporta tool calling cuando las tools están conectadas en n8n como `ai_tool`.
- Si el modelo emite `<function=name>{...}` como texto plano, n8n no está pasando las tools al modelo. Verificar que `trigger_manychat_flow` y `set_stage` están conectadas al nodo AI Agent con tipo `ai_tool`.
- El prompt explícito sobre cómo y cuándo usar cada tool mejora mucho la tasa de éxito.
- El `ns` no se adivina — se inyecta desde la DB (`stage_flows`, vía `Get Stage Config`; ver `nodes/01-build-context.md`).
