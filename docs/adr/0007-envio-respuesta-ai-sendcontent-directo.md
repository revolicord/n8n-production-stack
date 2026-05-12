# ADR-0007: Envío de respuesta IA vía sendContent directo (no setCustomFields + flow)

**Status:** Accepted  
**Date:** 2026-05-12

---

## Contexto

El workflow `agent-run` necesita enviar la respuesta del agente IA al usuario de Instagram DM una vez que el LLM ha procesado el turno. Se evaluaron dos enfoques para hacer llegar el texto al suscriptor a través de ManyChat.

---

## Opciones evaluadas

### Opción A — setCustomFields + sendFlow (rechazada)

1. n8n llama `POST /fb/subscriber/setCustomFields` para almacenar la respuesta en campos personalizados de ManyChat (`response part1`, `response part2`, `response part3`)
2. n8n llama `POST /fb/sending/sendFlow` para disparar un flow de ManyChat que lee esos campos y los envía como burbujas de mensaje

**Pros:**
- ManyChat controla el timing y formato de los mensajes
- Se pueden añadir delays entre burbujas desde ManyChat sin tocar n8n

**Contras:**
- 2 llamadas a la API de ManyChat por cada turno (mínimo)
- Requiere mantener campos personalizados y un flow adicional en ManyChat
- Acoplamiento entre n8n y la configuración interna de ManyChat
- Latencia adicional innecesaria

### Opción B — sendContent directo (aceptada)

n8n llama `POST /fb/sending/sendContent` con el texto de la respuesta IA directamente.

```json
{
  "subscriber_id": "MANYCHAT_ID",
  "data": {
    "version": "v2",
    "content": {
      "messages": [
        { "type": "text", "text": "Parte 1 de la respuesta" },
        { "type": "text", "text": "Parte 2 (si aplica)" }
      ]
    }
  },
  "message_tag": "HUMAN_AGENT"
}
```

**Pros:**
- 1 sola llamada a la API de ManyChat
- Sin dependencias en campos personalizados ni flows auxiliares en ManyChat
- Latencia mínima — el mensaje llega en la misma operación
- El array `messages` permite múltiples burbujas en una sola llamada

**Contras:**
- n8n gestiona el particionado del texto (necesario por límite de 1000 chars por burbuja en Instagram)

---

## Decisión

**Usar sendContent directo (Opción B).**

La Opción A añade complejidad operativa y duplica las llamadas a API sin beneficio real para el caso de uso actual. El particionado del texto se maneja en un nodo Code de n8n antes de llamar a sendContent, agrupando todas las partes en el array `messages` de una sola llamada.

---

## Implementación en el workflow

Nodo HTTP Request `enviar texto` → `POST https://api.manychat.com/fb/sending/sendContent`

El nodo Code `Format Response` (previo) construye el array de mensajes:

```javascript
// Partir respuesta en burbujas de hasta 900 chars
const parts = splitIntoParts(agentOutput, 900);
const messages = parts.map(text => ({ type: 'text', text }));

return [{
  json: {
    subscriber_id: subscriberId,
    data: {
      version: 'v2',
      content: { messages }
    },
    message_tag: 'HUMAN_AGENT'
  }
}];
```

---

## Cuándo revisar

Si en el futuro se necesita enviar media (imágenes, audio) generada dinámicamente, o aplicar delays entre burbujas de más de 1 segundo, re-evaluar si un flow de ManyChat aporta valor suficiente para justificar las llamadas adicionales.

---

## Referencias

- ADR-0006: Adaptación del payload de ManyChat al DM API
- ManyChat API: `POST /fb/sending/sendContent`
- Workflow: `n8n/agent-run.json`
