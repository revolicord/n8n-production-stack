# Nodo: sendFlow

**Tipo:** HTTP Request  
**Posición en flujo:** rama false de Type is text? → After Send

---

## Propósito

Dispara un flow de ManyChat para el suscriptor. Se usa cuando `followup_type` es `flow` o `content`.

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
