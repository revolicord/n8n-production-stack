# ADR-0006: Adaptación del payload de ManyChat al DM API

**Status:** Accepted  
**Date:** 2026-05-11

---

## Contexto

El DM API (`apps/api`) expone `POST /webhook/manychat` como punto de entrada para eventos de Instagram DM enviados desde ManyChat. El schema Zod original fue diseñado con un contrato de payload genérico que incluía `message.id` como campo requerido. Al integrar ManyChat real, se comprobó que su payload no envía ningún ID de mensaje, lo que causaba un `400 INVALID_PAYLOAD` en cada llamada.

### Payload real que envía ManyChat

```json
{
  "tenant_slug": "{{cuf_14564271}}",
  "trigger": {
    "source": "{{cuf_14564264}}",
    "channel": "{{cuf_14564265}}",
    "ref": "{{cuf_14564266}}"
  },
  "subscriber": {
    "manychat_id": "1701646954",
    "ig_username": "{{ig_username}}",
    "ig_page_name": "yordibayeux",
    "first_name": "Eddy",
    "last_name": "Salazar",
    "full_name": "Eddy Salazar",
    "subscribed_at": "2026-05-02 23:42:43.447479"
  },
  "message": {
    "text": "{{last_input_text}}",
    "reply_type": "{{last_reply_type}}"
  },
  "instagram_context": {
    "messaging_window": "{{ig_messaging_window}}",
    "last_interaction": "{{last_ig_interaction}}",
    "last_seen": "{{last_ig_seen}}",
    "opt_in": "",
    "follows_you": "{{is_ig_account_follower}}",
    "followers_count": "{{ig_followers_count}}",
    "verified": "{{is_ig_verified_user}}"
  }
}
```

---

## Decisión

Adaptar el schema Zod y la ruta del webhook para que el API acepte el payload real de ManyChat sin modificar la estructura de la base de datos.

---

## Cambios aplicados

### 1. `packages/shared/src/schemas/manychat.ts`

| Campo | Antes | Después |
|---|---|---|
| `message.id` | `z.string().min(1)` (requerido) | `.optional()` |
| `message.reply_type` | no existía | `z.string().optional()` |
| `subscriber.first_name` | no existía | `z.string().optional()` |
| `subscriber.last_name` | no existía | `z.string().optional()` |
| `subscriber.full_name` | no existía | `z.string().optional()` |
| `subscriber.ig_page_name` | no existía | `z.string().optional()` |
| `subscriber.subscribed_at` | no existía | `z.string().optional()` |
| `instagram_context` | no existía | `ManyChatInstagramContextSchema.optional()` |

### 2. `apps/api/src/routes/webhook-manychat.ts`

**Generación de ID de mensaje cuando ManyChat no lo envía:**

```typescript
const receivedAt = Date.now();
const externalMessageId =
  event.message.id ?? `${event.subscriber.manychat_id}_${event.tenant_slug}_${receivedAt}`;
```

El ID generado combina `manychat_id + tenant_slug + timestamp_ms`. Esto es consistente con la documentación interna del proyecto: cuando la fuente no provee un ID, el API lo genera con información del contacto y el instante de recepción en milisegundos.

**Mapping de nombre para `display_name`:**

```typescript
displayName: event.subscriber.full_name ?? event.subscriber.name,
```

ManyChat envía `full_name`, no `name`. El campo `display_name` en la DB se sigue poblando correctamente.

### 3. `apps/api/src/services/messages.ts`

```typescript
// Antes
externalMessageId: string;

// Después
externalMessageId: string | null;
```

La columna `external_message_id` ya era nullable en la DB (`messagesRaw` schema en Drizzle). El tipo TypeScript ahora refleja esa realidad.

---

## Idempotencia sin ID de mensaje

El sistema de deduplicación usa `sha256(tenantId:subscriberId:externalMessageId)`. Cuando ManyChat no envía `message.id`, el ID generado con timestamp en milisegundos actúa como pseudo-único por request. Esto significa:

- **Reintentos de ManyChat** que lleguen en milisegundos distintos crearán entradas separadas (sin dedup entre reintentos).
- **Duplicados deliberados** (usuario enviando el mismo texto dos veces) se almacenarán correctamente como dos mensajes distintos.

Este tradeoff es aceptable mientras ManyChat no exponga un ID de mensaje en su payload de Custom Fields.

---

## Flujo actualizado

```
ManyChat → POST /webhook/manychat
              │
              ├─ Validación Zod (ManyChatWebhookSchema)
              ├─ Resolve tenant por tenant_slug
              ├─ Upsert subscriber (full_name → display_name)
              ├─ Generar externalMessageId si no viene en payload
              ├─ Hash idempotencia (tenant:subscriber:externalMessageId)
              ├─ Insertar messages_raw (payload completo en JSONB)
              └─ Push buffer Redis → BullMQ → n8n workflow
```

---

## Despliegue

Después de este cambio es necesario reconstruir la imagen Docker:

```bash
make rebuild-api
```

O si el API corre vía Dokploy/CI: hacer push del código y disparar un nuevo build.

---

## Referencias

- Schema Zod: `packages/shared/src/schemas/manychat.ts`
- Ruta webhook: `apps/api/src/routes/webhook-manychat.ts`
- Servicio mensajes: `apps/api/src/services/messages.ts`
- ADR-0005: arquitectura original de webhooks vía n8n nativo
