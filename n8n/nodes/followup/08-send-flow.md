# Nodo: sendFlow

**Tipo:** HTTP Request  
**ID:** `f6d932bd-f2f5-4433-a1c7-f656e9402a5c`  
**Posición en flujo:** rama flow de Type is text? → After Send (input 1)

---

## Propósito

Dispara un flow de ManyChat para el suscriptor. Se usa cuando `followup_type` es `flow`.

---

## Configuración

```json
{
  "method": "POST",
  "url": "https://api.manychat.com/fb/sending/sendFlow",
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
  "jsonBody": "=JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, flow_ns: $json.followup_flow_ns })"
}
```

---

## Campos utilizados

| Campo | Descripción |
|-------|-------------|
| `mc_api_key` | API key de ManyChat del tenant |
| `manychat_subscriber_id` | ID numérico del suscriptor |
| `followup_flow_ns` | Namespace del flow en ManyChat (ej. `QC_stage_a_followup_1`) |

---

## Payload enviado a ManyChat

```json
{
  "subscriber_id": "1724803790",
  "flow_ns": "QC_stage_a_followup_1"
}
```

---

## Conexión posterior

→ **After Send (input 1)**

---

## Nota de versión (ADR-0020)

Antes de ADR-0020 este nodo recibía también `type='content'`, lo que generaba un `sendFlow` con `flow_ns=NULL` → error silencioso. Ahora `content` va por su propia rama: **Build Content Messages** → **sendContentMessages**.
