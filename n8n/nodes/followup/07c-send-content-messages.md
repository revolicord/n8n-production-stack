# Nodo: sendContentMessages

**Tipo:** HTTP Request  
**ID:** `b5c6d7e8-f9a0-4123-b5c6-d7e8f9a01234`  
**Posición en flujo:** después de Build Content Messages → After Send (input 2)

---

## Propósito

Envía imagen + texto al suscriptor vía `sendContent` de ManyChat cuando el template es `type='content'`. Recibe `mcMessages` construido por el nodo anterior.

---

## Configuración

```json
{
  "method": "POST",
  "url": "https://api.manychat.com/fb/sending/sendContent",
  "sendHeaders": true,
  "headerParameters": {
    "parameters": [
      { "name": "Authorization", "value": "=\"Bearer \" + $json.mc_api_key" }
    ]
  },
  "sendBody": true,
  "specifyBody": "json",
  "jsonBody": "=JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, data: { version: 'v2', content: { type: 'instagram', messages: $json.mcMessages } } })"
}
```

---

## Payload enviado a ManyChat (ejemplo)

```json
{
  "subscriber_id": "1724803790",
  "data": {
    "version": "v2",
    "content": {
      "type": "instagram",
      "messages": [
        { "type": "image", "url": "https://minio.../assets/tenant/meme.jpg" },
        { "type": "text", "text": "Hola Juan, ¿cómo te fue con el VSL?" }
      ]
    }
  }
}
```

---

## Campos utilizados

| Campo | Procedencia |
|-------|-------------|
| `mc_api_key` | `tenants.config->>'manychat_api_key'` (Get Due Leads) |
| `manychat_subscriber_id` | `subscribers.manychat_subscriber_id` (Get Due Leads) |
| `mcMessages` | Construido por Build Content Messages |

---

## Conexión posterior

→ **After Send (input 2)**
