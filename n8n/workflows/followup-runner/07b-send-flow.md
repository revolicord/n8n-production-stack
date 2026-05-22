# Nodo 07b: sendFlow

**Tipo:** HTTP Request (`n8n-nodes-base.httpRequest`)  
**ID:** `2efe38d3-939c-49fa-97af-24e2c1f7112b`  
**Posición en cadena:** rama FALSE de `Type is text?`, antes de `After Send`  
**Propósito:** Disparar un flow de ManyChat en el suscriptor Instagram via `sendFlow`, usando el namespace del template.

---

## Request

```
POST https://api.manychat.com/fb/sending/sendFlow
```

### Headers

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer <mc_api_key>` |

### Body (JSON)

```json
{
  "subscriber_id": "<manychat_subscriber_id>",
  "flow_ns": "<followup_flow_ns>"
}
```

## Configuración n8n

```json
{
  "method": "POST",
  "url": "https://api.manychat.com/fb/sending/sendFlow",
  "headerParameters": {
    "parameters": [
      {
        "name": "Authorization",
        "value": "=\"Bearer \" + $json.mc_api_key"
      }
    ]
  },
  "specifyBody": "json",
  "jsonBody": "=JSON.stringify({ subscriber_id: $json.manychat_subscriber_id, flow_ns: $json.followup_flow_ns })"
}
```

## Campos utilizados del ítem

| Campo | Procedencia |
|-------|-------------|
| `mc_api_key` | `tenants.config->>'manychat_api_key'` (Get Due Leads) |
| `manychat_subscriber_id` | `subscribers.manychat_subscriber_id` (Get Due Leads) |
| `followup_flow_ns` | `followup_templates.flow_ns` (Get Due Leads) |

## Notas

- `flow_ns` es el namespace interno de ManyChat (ej. `content20240501...`). Se define en `followup_templates.flow_ns` y debe corresponderse con un flow publicado en ManyChat.
- Ver `n8n/flows-catalog.md` para el mapeo nombre → namespace de todos los flows.
- A diferencia de `sendContent`, el contenido real del mensaje lo controla ManyChat; `chatMemoryText` en **Prepare Data** usa `followup_description` como resumen para la memoria del agente.
