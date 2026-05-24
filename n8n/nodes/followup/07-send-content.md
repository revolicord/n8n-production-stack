# Nodo: sendContent

**Tipo:** HTTP Request  
**ID:** `11923b3e-5f8d-4d1b-88b0-f52eab5df3fe`  
**Posición en flujo:** rama text de Type is text? → After Send

---

## Propósito

Envía un mensaje de texto directo al suscriptor via ManyChat API (`sendContent`). Se usa cuando `followup_type === 'text'`.

---

## Configuración

```json
{
  "method": "POST",
  "url": "https://api.manychat.com/fb/sending/sendContent",
  "sendHeaders": true,
  "headerParameters": {
    "parameters": [
      {
        "name": "Authorization",
        "value": "=\"Bearer \" + $json.mc_api_key"
      }
    ]
  },
  "sendBody": true,
  "specifyBody": "json",
  "jsonBody": "=JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, data: { version: 'v2', content: { type: 'instagram', messages: [{ type: 'text', text: $json.textSent }] } } })"
}
```

---

## Campos utilizados

| Campo | Descripción |
|-------|-------------|
| `mc_api_key` | API key de ManyChat del tenant |
| `manychat_subscriber_id` | ID numérico del suscriptor en ManyChat |
| `textSent` | Texto ya interpolado con el nombre del suscriptor |

---

## Payload enviado a ManyChat

```json
{
  "subscriber_id": "1724803790",
  "data": {
    "version": "v2",
    "content": {
      "type": "instagram",
      "messages": [
        { "type": "text", "text": "Hola Juan, ¿cómo estás?" }
      ]
    }
  }
}
```

---

## Conexión posterior

→ **After Send (input 0)**
