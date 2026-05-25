# Nodo 07a: sendContent

**Tipo:** HTTP Request (`n8n-nodes-base.httpRequest`)  
**ID:** `d9ec2a2f-da32-4f05-9fb3-802138c22e1c`  
**Posición en cadena:** rama TRUE de `Type is text?`, antes de `After Send`  
**Propósito:** Enviar un mensaje de texto al suscriptor Instagram via la API de ManyChat (`sendContent`).

---

## Request

```
POST https://api.manychat.com/fb/sending/sendContent
```

### Headers

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer <mc_api_key>` |

### Body (JSON)

```json
{
  "subscriber_id": "<manychat_subscriber_id>",
  "data": {
    "version": "v2",
    "content": {
      "type": "instagram",
      "messages": [
        {
          "type": "text",
          "text": "<textSent>"
        }
      ]
    }
  }
}
```

## Configuración n8n

```json
{
  "method": "POST",
  "url": "https://api.manychat.com/fb/sending/sendContent",
  "headerParameters": {
    "parameters": [
      {
        "name": "Authorization",
        "value": "=\"Bearer \" + $json.mc_api_key"
      }
    ]
  },
  "specifyBody": "json",
  "jsonBody": "=JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, data: { version: 'v2', content: { type: 'instagram', messages: [{ type: 'text', text: $json.textSent }] } } })"
}
```

## Campos utilizados del ítem

| Campo | Procedencia |
|-------|-------------|
| `mc_api_key` | `tenants.config->>'manychat_api_key'` (Get Due Leads) |
| `manychat_subscriber_id` | `subscribers.manychat_subscriber_id` (Get Due Leads) |
| `textSent` | Texto interpolado (Prepare Data) |

## Notas

- `type: 'instagram'` es obligatorio para cuentas IG conectadas en ManyChat.
- Si la API retorna error (4xx/5xx), n8n marca el ítem como error. Considerar agregar un bloque `onError: continueErrorOutput` y registrar `status = 'failed'` en `lead_followup_log`.
