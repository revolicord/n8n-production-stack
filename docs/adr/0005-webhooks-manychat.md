# ADR-0005: Integración de Webhooks ManyChat / Instagram

**Status:** Accepted  
**Date:** 2026-05-01

---

## Y-Statement

> _In the context of_ receiving Instagram DM events from ManyChat to trigger n8n workflows,  
> _facing_ the need for reliable, authenticated webhook ingestion that survives n8n restarts,  
> _we decided_ to use **n8n's native webhook node** con `N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true` en el webhook processor,  
> _to achieve_ que ManyChat puede enviar eventos a una URL estable que siempre está activa (webhook processor separado del main),  
> _accepting_ que la URL de webhook cambia si se elimina y recrea el workflow (usar Update en vez de Delete).

---

## Flujo de un evento Instagram → ManyChat → n8n

```
Usuario envía DM en Instagram
        ↓
ManyChat detecta el evento
        ↓
POST https://paneln8n.revolicord.com/webhook/<workflow-id>
        ↓
Traefik  (TLS termination, PathPrefix /webhook/)
        ↓
n8n-webhook:5678  (recibe, valida, encola job en Redis)
        ↓
Redis Queue (Bull)
        ↓
n8n-worker (uno de los 3 ejecuta el workflow)
        ↓
[acciones: responder DM, guardar en DB, notificar, etc.]
```

## Configuración del Webhook Node en n8n

1. Crear workflow con node **Webhook** como trigger
2. Método: `POST`
3. Path: elegir un nombre descriptivo, ej. `manychat-instagram`
4. Authentication: **Header Auth** con un token secreto
   - Header name: `X-Webhook-Secret`
   - Header value: generar con `openssl rand -hex 32`
5. En ManyChat: configurar el mismo token como header en la integración

URL resultante:
```
https://paneln8n.revolicord.com/webhook/manychat-instagram
```

## Seguridad del webhook

ManyChat no firma sus requests con HMAC (a diferencia de otros servicios). La autenticación recomendada es:
- **Header Auth** en n8n (un token secreto conocido solo por ManyChat y n8n)
- **IP allowlist** en Traefik (opcional, si ManyChat publica sus IPs de salida)

Añadir Header Auth en n8n Webhook node (opción "Header Auth"):
- Nombre del header: `Authorization`
- Valor: `Bearer <TOKEN_SECRETO>`

En ManyChat (cuando configure la integración webhook): añadir el mismo header.

## Formato del payload de ManyChat

ManyChat envía JSON con información del usuario de Instagram. Campos típicos:
```json
{
  "user": {
    "id": "...",
    "first_name": "...",
    "last_name": "...",
    "profile_pic": "...",
    "locale": "es",
    "timezone": -4
  },
  "flow_ns": "...",
  "step_ns": "...",
  "custom_fields": {}
}
```

## Variable crítica en n8n-webhook

```bash
N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true
```

Sin esta variable, cuando el container `n8n-webhook` se reinicia (deploy, crash), intenta desregistrar los webhooks de la DB. Si el proceso muere antes de completar el ciclo, ManyChat puede recibir 404 temporalmente. Con la variable, los webhooks permanecen registrados en DB durante reinicios.

## Test end-to-end

```bash
# Probar que el webhook responde (antes de configurar ManyChat)
curl -X POST https://paneln8n.revolicord.com/webhook/manychat-instagram \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"test": true}'

# Debe responder 200 si el workflow está activo
```
