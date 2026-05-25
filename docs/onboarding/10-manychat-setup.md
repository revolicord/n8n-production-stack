# 10 · ManyChat setup, canales y triggers

Este documento define **toda la configuración necesaria en ManyChat** para que el sistema funcione. Es el contrato entre lo que ManyChat envía y lo que Fastify espera recibir.

> Aplica al MVP de Quantum Creators (`tenant_slug: quantum-creators`). Para futuros clientes (cuando dejen de ser teóricos), se replica esta configuración en su cuenta de ManyChat con su propio `tenant_slug`.

> **Dos cosas cambiaron desde que se escribió este doc:** (1) el mapeo `flow_name → ns` ya **no** vive en `tenants.config.flows`, sino en el registro `stage_flows` (ver [09-flow-registry-manychat](09-flow-registry-manychat.md)); (2) la idempotencia real usa `external_message_id` (o uno generado), no el hash de contenido + bucket de 30 s que se describe más abajo — el contrato real está en [05-api-fastify-endpoints](05-api-fastify-endpoints.md).

## Resumen de lo que hay que hacer en ManyChat

1. Crear 4 Custom User Fields globales.
2. Crear 1 token secreto compartido con Fastify.
3. Configurar 4 flows existentes con la **misma estructura idéntica**: setear custom fields → External Request al webhook único.
4. Mantener 4 flows existentes de "Envío de X" intactos (los dispara n8n vía API de ManyChat, no se tocan).

## Custom User Fields

En **Configuración → Campos → Campos de usuario**, crear:

| Nombre exacto | Tipo | Default value | Descripción |
|---|---|---|---|
| `tenant_slug` | Texto | `quantum-creators` | Identifica al cliente de Vystral. Constante para toda la cuenta. |
| `trigger_source` | Texto | (vacío) | Qué automatización disparó el evento. Lo setea cada flow antes del External Request. |
| `trigger_channel` | Texto | (vacío) | Por qué canal de IG entró el lead. |
| `trigger_ref` | Texto | (vacío) | Referencia opcional (ID de post, keyword, etc.). Solo en flows que la usen. |

## Token compartido

Generar con:
```bash
openssl rand -hex 32
```

Guardar en dos sitios:
- En el servidor de Alex: variable de entorno `MC_WEBHOOK_TOKEN` del servicio `api` Fastify.
- En cada External Request de ManyChat como header `X-MC-Token`.

Este token autentica que el webhook viene de ManyChat. Si Fastify recibe un POST en `/webhook/manychat` sin este header válido, responde 401.

## Body del External Request (canónico)

Este JSON es **idéntico** en los 4 flows que disparan al webhook. Solo cambian los valores de los custom fields que se setean **antes** del External Request.

```json
{
  "tenant_slug": "{{tenant_slug}}",
  "trigger": {
    "source": "{{trigger_source}}",
    "channel": "{{trigger_channel}}"
  },
  "subscriber": {
    "manychat_id": "{{user_id}}",
    "ig_username": "{{ig_username}}",
    "ig_page_name": "{{instagram_account_name}}",
    "first_name": "{{first_name}}",
    "last_name": "{{last_name}}",
    "full_name": "{{full_name}}",
    "subscribed_at": "{{subscribed}}"
  },
  "message": {
    "text": "{{last_input_text}}"
  },
  "instagram_context": {
    "last_interaction": "{{last_ig_interaction}}",
    "last_seen": "{{last_ig_seen}}",
    "opt_in": "{{optin_instagram}}",
    "follows_you": "{{is_ig_account_follower}}",
    "followers_count": "{{ig_followers_count}}",
    "verified": "{{is_ig_verified_user}}"
  }
}
```

**Notas sobre variables**:

- `{{tenant_slug}}`, `{{trigger_source}}`, `{{trigger_channel}}` → custom fields creados arriba.
- `{{user_id}}`, `{{ig_username}}`, `{{first_name}}`, etc. → System Fields nativos de ManyChat. Resolución automática.
- Variables que no existan en una cuenta llegan como literal `"{{nombre}}"` y Fastify las normaliza a `null` con Zod.
- **No incluir** `trigger.ref` aquí. Si un flow la usa, **ese flow específico añade un campo extra al body** (ver tabla más abajo).

### Configuración HTTP del External Request

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://api.<dominio-alex>/webhook/manychat` |
| Headers | `Content-Type: application/json`<br>`X-MC-Token: <token-generado>` |
| Body Type | Raw JSON |
| Body | El JSON de arriba |
| Response Mapping | (opcional, ignorar en MVP) |

## Tabla de configuración por flow

Esta es la tabla **definitiva** para los 4 flows existentes en la cuenta de Alex (basado en las capturas analizadas). Cada flow setea los 4 custom fields con estos valores antes del External Request:

| Flow en ManyChat | Estado actual | `tenant_slug` | `trigger_source` | `trigger_channel` | `trigger_ref` | Body extra |
|---|---|---|---|---|---|---|
| **Instagram Default Reply** | LIVE | `quantum-creators` | `default_reply` | `instagram_dm` | (no setear) | (sin extras) |
| **usuario responde a tu historia** | DRAFT → activar | `quantum-creators` | `story_reply` | `instagram_story` | (no setear) | (sin extras) |
| **User comenta publicación o reel** | DRAFT → activar | `quantum-creators` | `comment_reply` | `instagram_comment` | (no setear si no hay post_id disponible) | (sin extras) |
| **usuario comparte publicación o reel** | DRAFT → activar | `quantum-creators` | `post_share` | `instagram_share` | (no setear) | (sin extras) |

**No se modifican** estos 4 flows (siguen siendo herramientas que dispara n8n):

| Flow | Función |
|---|---|
| Envio de stickers | Container de stickers que dispara n8n vía API ManyChat |
| Envio de imagenes | Idem para imágenes |
| Envio de audios | Idem para audios pregrabados (Vídeo 1 audio intro, "¿viste el vídeo?", etc.) |
| Envio de mensajes | Idem para mensajes de texto pregrabados |

## Estructura visual de cada flow modificado

```
[Trigger del flow]
   ↓
[Acción: Establecer campo personalizado]
   tenant_slug      = "quantum-creators"
   ↓
[Acción: Establecer campo personalizado]
   trigger_source   = "<valor según tabla>"
   ↓
[Acción: Establecer campo personalizado]
   trigger_channel  = "<valor según tabla>"
   ↓
[Acción: External Request]
   POST → https://api.<dominio>/webhook/manychat
   Body: el JSON canónico
   ↓
[(opcional, vacío en MVP)]
```

> En ManyChat, las acciones "Set Custom User Field" se pueden combinar en un solo nodo si la UI lo permite. Si no, son 3 nodos consecutivos. Ambas formas son equivalentes.

## Validación end-to-end

Tras configurar cada flow, validar manualmente disparándolo:

| Trigger del flow | Cómo simularlo |
|---|---|
| Default Reply | Mandar un DM cualquiera a la cuenta de Alex desde otra cuenta de IG |
| Story Reply | Responder a una story de @quantumcreators |
| Comment Reply | Comentar un post de @quantumcreators con la keyword configurada |
| Post Share | Compartir un post de @quantumcreators a la cuenta vía DM |

Verificar que:
- El JSON llega con todos los campos resueltos (sin `{{nombre}}` literales en los nuevos campos).
- `tenant_slug`, `trigger.source`, `trigger.channel` tienen los valores esperados.
- El timestamp del log de Fastify es <500 ms tras enviar el mensaje.

Si llega `"{{trigger_source}}"` literal, significa que el custom field no se setea antes del External Request o el campo no existe → revisar el orden de nodos en el flow.

## Casos especiales y pendientes

### `trigger.ref` para Comment Reply

ManyChat **no expone el `post_id` ni `comment_id` como variable nativa** disponible en todos los planes. Si en el futuro se descubre la variable correcta:
- Añadir `"ref": "post:{{nombre_de_la_variable}}"` al body de **ese flow específico**.
- En Fastify, el agente puede usar el ref para personalizar la respuesta ("vi que comentaste mi post sobre X").

Para el MVP no es bloqueante.

### Keyword DMs

Si en el futuro Alex añade flows de keyword (ej: el lead manda "INFO" y eso dispara un flow específico), añadir entrada a la tabla:

| Keyword DM | `quantum-creators` | `keyword_dm` | `instagram_dm` | `keyword:<la_keyword>` | sí, con ref |

### Múltiples cuentas de IG bajo la misma cuenta de ManyChat

Si Alex conecta una segunda cuenta de IG a la misma cuenta de ManyChat (escenario Y del setup):
- El payload incluye `instagram_context.ig_page_name` (resuelto automáticamente).
- Fastify enruta y diferencia conversaciones por (subscriber, ig_page_name).
- No hace falta cambiar la configuración base, solo Fastify lo gestiona.

## Antipatrones a evitar

❌ **Crear flows distintos con External Requests a URLs distintas**. Aumenta superficie de mantenimiento sin beneficio. Un solo webhook y discriminación por `trigger.source`.

❌ **Setear `tenant_slug` por flow en lugar de como default**. Si en algún flow se olvida, los webhooks llegan sin tenant y Fastify los rechaza. Mejor: default value en la creación del field, **y** además setearlo defensivamente en cada flow.

❌ **Hardcodear el token en el body en lugar del header**. El header es estándar y rotable. El body es ruido.

❌ **Tocar los flows "Envío de X"**. Esos son receptores, no emisores. n8n los dispara cuando el agente decide enviar contenido pregrabado.

❌ **Meter lógica del agente en ManyChat**. ManyChat es solo el "adaptador" Instagram → webhook y el "adaptador" comando-de-n8n → mensaje-en-IG. La inteligencia vive en n8n + LLM.

## Schema Zod en Fastify para este payload

```ts
// packages/shared/src/schemas/manychat.ts
import { z } from 'zod';

const unresolved = z.string().transform(v =>
  v === '' || /^\{\{.+\}\}$/.test(v) ? null : v
);

export const ManyChatWebhookSchema = z.object({
  tenant_slug: z.string().min(1),
  trigger: z.object({
    source: z.enum([
      'default_reply',
      'story_reply',
      'comment_reply',
      'post_share',
      'keyword_dm',
      'ice_breaker',
      'ad_lead',
    ]),
    channel: z.enum([
      'instagram_dm',
      'instagram_story',
      'instagram_comment',
      'instagram_share',
    ]),
    ref: z.string().nullable().optional(),
  }),
  subscriber: z.object({
    manychat_id: z.string().min(1),
    ig_username: z.string().optional(),
    ig_page_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    full_name: z.string().optional(),
    subscribed_at: z.string().optional(),
  }),
  message: z.object({
    text: z.string().default(''),
  }),
  instagram_context: z.object({
    last_interaction: z.string().nullable().optional(),
    last_seen: z.string().nullable().optional(),
    opt_in: z.string().nullable().optional(),
    follows_you: unresolved.nullable().optional(),
    followers_count: z.coerce.number().int().nullable().optional(),
    verified: unresolved.nullable().optional(),
  }).optional(),
});

export type ManyChatWebhookEvent = z.infer<typeof ManyChatWebhookSchema>;
```

## Construcción del `message_id` en Fastify

ManyChat no provee `message_id` único. Se construye al recibir:

```ts
const received_at_ms = Date.now();
const seq = await redis.incr(
  `seq:${tenant_slug}:${manychat_id}:${received_at_ms}`
);
await redis.expire(
  `seq:${tenant_slug}:${manychat_id}:${received_at_ms}`,
  5
);
const message_id = `${tenant_slug}:${manychat_id}:${received_at_ms}:${seq}`;
```

## Idempotencia

Como el `message_id` lo genera Fastify, no sirve para detectar reintentos. La idempotencia se basa en contenido + ventana temporal:

```ts
const idempotency_hash = sha256([
  tenant_slug,
  manychat_id,
  trigger.source,
  message.text,
  Math.floor(received_at_ms / 30_000),  // bucket de 30s
].join(':'));
```

Si Fastify recibe dos webhooks con el mismo hash en menos de 30 segundos, descarta el segundo (es un reintento de ManyChat por timeout o error).

## Disparar contenido pregrabado desde n8n

Cuando el agente decide enviar Vídeo 1, Vídeo 2, audio, sticker o imagen, n8n llama a la **API de ManyChat** para disparar el flow correspondiente:

```
POST https://api.manychat.com/fb/sending/sendFlow
Authorization: Bearer <api_key_de_manychat>
Content-Type: application/json

{
  "subscriber_id": "<manychat_id>",
  "flow_ns": "<namespace_del_flow>"
}
```

Cada flow de "Envío de X" en ManyChat tiene un `flow_ns` que se obtiene de la URL del flow en la UI o de la API. Estos `flow_ns` se guardan en la tabla `tenants.config` de Postgres como diccionario:

```json
{
  "flows": {
    "video_hook":     "content:1234567",
    "video_vsl":      "content:7654321",
    "audio_did_you_see_video": "content:1111111",
    "audio_engaged":  "content:2222222",
    "sticker_thanks": "content:3333333"
  }
}
```

El agente en n8n consulta este diccionario por nombre semántico (`video_hook`) y obtiene el `flow_ns` técnico. Esto permite cambiar los flows en ManyChat sin tocar el agente.

## Checklist de configuración (para Alex)

- [ ] Custom field `tenant_slug` creado con valor `quantum-creators`
- [ ] Custom field `trigger_source` creado
- [ ] Custom field `trigger_channel` creado
- [ ] Custom field `trigger_ref` creado
- [ ] Token `MC_WEBHOOK_TOKEN` generado y compartido
- [ ] Flow "Instagram Default Reply" actualizado con setters + External Request
- [ ] Flow "usuario responde a tu historia" idem y activado (LIVE)
- [ ] Flow "User comenta publicación o reel" idem y activado (LIVE)
- [ ] Flow "usuario comparte publicación o reel" idem y activado (LIVE)
- [ ] Cada flow probado disparando manualmente desde otra cuenta de IG
- [ ] Logs de Fastify confirman llegada con todos los campos resueltos
- [ ] `flow_ns` de los flows "Envío de X" anotados en `tenants.config.flows`
