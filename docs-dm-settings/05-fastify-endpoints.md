# 05 · Endpoints Fastify

Contrato HTTP. Todo cambio aquí debe pasar por una versión nueva o ADR.

## Estructura general

```
/healthz                   GET    Liveness probe
/readyz                    GET    Readiness (DB + Redis OK)
/metrics                   GET    Prometheus

/webhook/manychat          POST   Webhook entrante de ManyChat
/webhook/manychat/test     POST   Eco para validar conectividad

/admin/turn-completed      POST   Callback desde n8n (cierra turno)
/admin/tenants             GET    Lista tenants
/admin/tenants/:id         GET|PATCH
/admin/subscribers         GET    Filtros: tenant, status, search
/admin/subscribers/:id     GET|PATCH
/admin/subscribers/:id/pause   POST  Body: { until: ISO8601 }
/admin/subscribers/:id/unpause POST
/admin/subscribers/:id/buffer  DELETE  Purgar buffer activo
/admin/turns               GET    Filtros: tenant, status, since
/admin/turns/:id           GET
/admin/turns/:id/retry     POST   Reencola en BullMQ
/admin/dlq                 GET    Items pendientes
/admin/dlq/:id/retry       POST
/admin/dlq/:id/resolve     POST   Body: { note: string }
/admin/conversations/:id   GET    Vista detallada con turns
/admin/conversations/:id/close POST
/admin/stats/overview      GET    Resumen del día (gráficas)
/admin/stats/costs         GET    Coste LLM por tenant
```

## Autenticación

| Endpoint | Método auth |
|---|---|
| `/healthz`, `/readyz`, `/metrics` | Sin auth (pero `/metrics` solo accesible en red interna) |
| `/webhook/manychat` | Header `X-MC-Token` (compartido con ManyChat) |
| `/admin/turn-completed` | Header `Authorization: Bearer ${N8N_CALLBACK_TOKEN}` |
| Resto de `/admin/*` | Header `Authorization: Bearer <admin_jwt>` con scope |

JWT admin con dos roles:
- `admin`: todo
- `n8n`: solo `/admin/subscribers/:id/pause`, `/admin/turns/:id/retry`, `/admin/dlq/*`, lecturas

Esto permite que **n8n haga acciones limitadas** en la API (la pieza clave de la pregunta del founder).

## Endpoints clave

### `POST /webhook/manychat`

Body (lo que envía ManyChat External Request, configurado por nosotros):

```json
{
  "tenant_slug": "agencia-cliente-x",
  "subscriber": {
    "manychat_id": "1234567890",
    "ig_user_id": "ig_98765",
    "ig_username": "juanperez",
    "name": "Juan Pérez",
    "locale": "es_ES"
  },
  "message": {
    "id": "mid.xxxx",
    "text": "hola, tenéis hueco mañana?",
    "timestamp": 1730000000,
    "media": []
  },
  "context": {
    "manychat_flow": "default-flow",
    "page_id": "..."
  }
}
```

Respuesta: `200 OK` con body vacío (siempre que sea válido o duplicado). `4xx` solo para auth/validación. **Nunca 5xx** salvo Redis/DB caídos: ManyChat reintenta agresivamente.

### `POST /admin/turn-completed`

Body desde n8n al final del workflow del agente:

```json
{
  "turn_id": "uuid",
  "status": "completed",
  "response_text": "Hola Juan! Sí, tenemos hueco mañana a las 11h y 17h",
  "input_tokens": 1234,
  "output_tokens": 156,
  "cost_usd": 0.000234,
  "model": "gpt-4o-mini",
  "prompt_version": "v3",
  "n8n_execution_id": "12345",
  "tools_used": ["check_calendar"],
  "error": null
}
```

### `POST /admin/turns/:id/retry`

Idempotente. Crea un nuevo turn con `parent_turn_id` apuntando al original, reusa el `batch_message_ids`. Útil para que n8n pueda exponer un botón "reintentar" en un workflow administrativo.

### `POST /admin/subscribers/:id/pause`

```json
{ "until": "2026-05-08T10:00:00Z", "reason": "user requested human" }
```

Mientras esté pausado, los webhooks entrantes responden 200 pero no se acumulan ni dispatch. Útil para handoff humano.

### `GET /admin/stats/overview?tenant=...&since=24h`

```json
{
  "messages_received": 1234,
  "messages_duplicated": 45,
  "turns_completed": 312,
  "turns_failed": 4,
  "avg_batch_size": 3.95,
  "avg_turn_duration_ms": 4200,
  "total_cost_usd": 1.23,
  "active_subscribers": 87,
  "dlq_pending": 2
}
```

## Validación: Zod en `packages/shared/src/schemas`

Toda request body y response body se valida con Zod. El schema vive en `packages/shared` y se reusa en API + tests + (si hay admin web) frontend.

```ts
// packages/shared/src/schemas/manychat.ts
import { z } from 'zod';

export const ManyChatWebhookSchema = z.object({
  tenant_slug: z.string().min(1),
  subscriber: z.object({
    manychat_id: z.string(),
    ig_user_id: z.string().optional(),
    ig_username: z.string().optional(),
    name: z.string().optional(),
    locale: z.string().optional(),
  }),
  message: z.object({
    id: z.string(),
    text: z.string().default(''),
    timestamp: z.number(),
    media: z.array(z.object({
      type: z.enum(['image', 'video', 'audio', 'file']),
      url: z.string().url(),
    })).default([]),
  }),
  context: z.record(z.string(), z.any()).optional(),
});

export type ManyChatWebhookEvent = z.infer<typeof ManyChatWebhookSchema>;
```

## Errores

Formato unificado:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Subscriber exceeded 20 messages per minute",
    "details": { "subscriber_id": "...", "current": 25 }
  }
}
```

Códigos:
- `INVALID_PAYLOAD` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409) — turn ya completado
- `RATE_LIMIT_EXCEEDED` (429)
- `UPSTREAM_FAILURE` (502) — n8n no responde
- `INTERNAL_ERROR` (500)

## Plugins Fastify recomendados

| Plugin | Para qué |
|---|---|
| `@fastify/sensible` | helpers HTTP estándar |
| `@fastify/helmet` | headers seguridad |
| `@fastify/rate-limit` | rate limit por IP a nivel global (defensa anti-DDoS) |
| `@fastify/cors` | si admin web está en otro dominio |
| `@fastify/swagger` + `@fastify/swagger-ui` | OpenAPI gratis para n8n |
| `pino-pretty` (solo dev) | logs legibles |
| `@fastify/under-pressure` | rechaza requests si event loop satura |

## OpenAPI / Swagger

Generar en build y exponer en `/docs` (solo en desarrollo y entornos staging). En producción se sirve solo a IPs internas. n8n puede importar el schema OpenAPI directamente para autogenerar los HTTP Request nodes.
