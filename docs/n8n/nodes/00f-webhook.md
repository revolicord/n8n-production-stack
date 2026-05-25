# Nodo: Webhook

**Tipo:** Webhook  
**ID:** `2d00d60e-43a8-491a-9569-8ca95613cbe0`  
**Versión:** v1  
**Posición en cadena:** Primero — dispara el workflow; envía en paralelo a `Get Stage Config` y `Get Subscriber CRM Context`  
**ADR:** ⚠️ *Pendiente asignar*

---

## Propósito

Punto de entrada del workflow. Recibe el payload del worker (DM Setter API) vía `POST /webhook/agent-run` y lo pasa al resto de la cadena. El nodo tiene `alwaysOutputData: true` para que la cadena continúe incluso si el body está vacío.

---

## Configuración

| Campo | Valor |
|-------|-------|
| HTTP Method | `POST` |
| Path | `agent-run` |
| Webhook ID | `02f8dbff-b2ec-4078-9946-a0ae2a064f22` |
| Always Output Data | `true` |

URL efectiva: `https://<n8n-host>/webhook/agent-run`

---

## Output que produce

El nodo emite el payload tal como llega en `$json.body`. Los nodos downstream acceden con `$json.body.*` (o `$('Webhook').first().json.body.*` desde nodos más adelante en la cadena).

Estructura del payload en `$json.body`:

```json
{
  "schema_version": "v1",
  "turn_id": "<uuid>",
  "callback_url": "https://api.revolicord.com/admin/turn-completed",
  "callback_token": "<token>",
  "tenant": {
    "id": "<uuid>",
    "slug": "revolicord",
    "config": {
      "manychat_api_key": "...",
      "calendly_url": "...",
      ...
    }
  },
  "subscriber": {
    "id": "<uuid>",
    "manychat_subscriber_id": "...",
    "ig_username": "...",
    "display_name": "...",
    "lead_stage": "A"
  },
  "conversation": { "id": "<uuid>", "opened_at": "..." },
  "instagram_context": { "last_seen": "...", "last_interaction": "...", ... },
  "messages": [
    { "id": "<uuid>", "text": "Hola", "reply_type": "...", "ts": 1234, "media_urls": [] }
  ],
  "trigger": { "source": "instagram_dm", "channel": "instagram_dm" }
}
```

## Conexiones

- **Output main[0]:** → `Get Stage Config` y `Get Subscriber CRM Context` (en paralelo)
