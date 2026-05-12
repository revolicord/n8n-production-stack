# Nodo: enviar texto

**Tipo:** HTTP Request  
**typeVersion:** 4.4  
**Propósito:** Enviar la respuesta del agente al usuario vía ManyChat sendContent (un solo API call).

---

## Configuración

| Campo | Valor |
|-------|-------|
| Method | `POST` |
| URL | `https://api.manychat.com/fb/sending/sendContent` |
| Authentication | None (header manual) |

### Headers

| Name | Value |
|------|-------|
| `Authorization` | `Bearer {{ $('Build Context').first().json.mcApiKey }}` |

### Body

**Specify Body:** `JSON`  
**Content-Type:** `application/json`

```json
{
  "subscriber_id": "{{ $('Build Context').first().json.subscriberId }}",
  "data": {
    "version": "v2",
    "content": {
      "messages": [{ "type": "text", "text": "{{ $json.output }}" }]
    }
  }
}
```

---

## Notas

- `$json.output` es la salida del nodo `AI Agent` (nodo inmediatamente anterior).
- **Sin `message_tag`** — Instagram DM no acepta `HUMAN_AGENT` (solo válido para Facebook Messenger).
- Si la respuesta supera 1000 caracteres, Instagram puede rechazarla. El system prompt instruye al LLM a ser conciso (máx. 2-3 oraciones) para evitar esto.
- Si en el futuro se necesitan múltiples burbujas, el array `messages` puede tener varios objetos `{ "type": "text", "text": "..." }`.

---

## Referencias

- ADR-0007: Decisión de usar sendContent directo vs setCustomFields+sendFlow
