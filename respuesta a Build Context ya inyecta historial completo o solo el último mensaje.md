# ¿Build Context inyecta historial completo o solo el último mensaje?

**Respuesta corta:** Build Context inyecta **solo los mensajes del turno actual**. El historial completo de la conversación lo gestiona el nodo **Postgres Chat Memory**, no Build Context.

---

## Evidencia en el código

### 1. Build Context — solo el turno actual

`docs/n8n/nodes/01-build-context.md`, líneas 65–72:

```javascript
const messages = body.messages   // ← lote del webhook actual (debounced 15s)
  .map(m => {
    if (m.reply_type === 'thumbs_up') return '👍 [el contacto reaccionó con pulgar arriba]';
    if (m.media_urls?.length > 0 && !m.text) return '[contenido multimedia recibido — no se puede leer]';
    return m.text ?? '[mensaje sin texto]';
  })
  .filter(Boolean)
  .join('\n');
```

`body.messages` es el batch que llegó al webhook en el turno actual: todos los mensajes que el usuario mandó en la misma ráfaga (ventana de debounce de 15 s). No incluye mensajes de turnos anteriores.

Este valor se exporta como `chatInput` y el AI Agent lo recibe como el mensaje del usuario (`Text = {{ $json.chatInput }}`).

### 2. Postgres Chat Memory — historial completo

`docs/n8n/nodes/02-ai-agent.md`, tabla de sub-nodos:

| Sub-nodo | Tipo de conexión |
|---|---|
| Postgres Chat Memory | `ai_memory` → AI Agent |

El nodo AI Agent de n8n/LangChain tiene un slot `ai_memory`. Cuando está conectado a Postgres Chat Memory, el framework hace automáticamente:

1. **Antes de invocar el LLM** — carga todos los turnos anteriores de la conversación desde Postgres usando el `sessionId` (= `conversationId`).
2. **Los inyecta** en la ventana de contexto como mensajes `HumanMessage` / `AIMessage`, por encima del `chatInput` del turno actual.
3. **Después de la respuesta** — persiste el nuevo par `(chatInput, respuesta)` en Postgres para el próximo turno.

Build Context no toca ese mecanismo. Es transparente al código del nodo.

---

## Capas que ve el LLM en cada turno

| Capa | Origen | Contenido |
|---|---|---|
| System prompt | Build Context | Prompt estático + etapa del lead + bloque CRM + flow seleccionado |
| Chat history | Postgres Chat Memory | Todos los turnos anteriores de esta conversación |
| Mensaje usuario (`chatInput`) | Build Context | Solo los mensajes del turno actual (lote debounceado) |

---

## Implicaciones de arquitectura

- **El historial no viaja por el webhook.** El webhook solo trae el lote del turno actual. Postgres Chat Memory es la única fuente de verdad del historial conversacional.
- **El `sessionId` de la memoria es crítico.** Si el campo `conversationId` cambia entre turnos (ej. nueva conversación en ManyChat para el mismo subscriber), el agente pierde el contexto — el historial queda en otra sesión.
- **Límite de ventana.** Postgres Chat Memory tiene un parámetro configurable de cuántos mensajes recupera (`Last N Messages`). Si la conversación es larga y ese valor es bajo, el agente solo ve los N turnos más recientes, no toda la historia.
- **Build Context no necesita gestionar historial.** Su responsabilidad es construir el system prompt dinámico (etapa, CRM, flow). El historial es responsabilidad exclusiva del sub-nodo de memoria.
