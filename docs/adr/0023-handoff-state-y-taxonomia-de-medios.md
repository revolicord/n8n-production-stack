# ADR-0023: Conciencia de handoff + taxonomía de medios por content_class

- **Estado:** aceptado
- **Fecha:** 2026-06-11

## Contexto

El agente de n8n solo "recuerda" dos cosas: la memoria conversacional de LangChain
(`n8n_chat_histories`, Postgres Memory) y el bloque `<context>` que arma `Build Context`
en cada turno. Todo el escalado a humano —audio/keyword deterministas en
`webhook-manychat.ts` y la acción `notify_human` del agente— se escribe en
`api.notifications`, pero **`Build Context` nunca leía esa tabla**. Consecuencias:

1. El agente no se enteraba de sus propios escalados ni de los deterministas, ni de
   cuándo un humano intervino. Al retomar una conversación pausada/reactivada
   arrancaba de cero ("está perdido").
2. El detector de medios solo conocía `audio` y keywords. Cualquier otro inbound
   (imagen, video, ubicación, archivo, sticker, share, desconocido) caía en el
   placeholder genérico `[contenido multimedia recibido — no se puede leer]`, una
   **mentira permanente en la memoria** del agente.
3. Cuando un humano pausaba al lead, el inbound se descartaba **antes de persistir**
   (paso 5, antes del audit-first del paso 7): ni quedaba registro.

Las keywords de escalado solo se editaban tocando el JSON del tenant a mano
(`tenant.config.notification_keywords`); no había UI.

## Decisión

### 1. handoff_state vía `<context>` (Decisión B, no turnos sintéticos)

Se descartó escribir mensajes "[SISTEMA: …]" en `n8n_chat_histories` (frágil al
formato interno de LangChain, consume la ventana de 20 turnos, riesgo de duplicar en
ráfagas). En su lugar:

- Nuevo nodo Postgres **`Get Handoff State`** lee `api.notifications` recientes del
  subscriber (24 h, `LIMIT 10`). Ver `docs/n8n/nodes/00h-get-handoff-state.md`.
- **`Build Context` v6** colapsa esas filas en una sección `handoff_state` del
  `contextJson` (`open_escalations`, `human_handled`, `last_human_action`).
- **System prompt v9 (regla 8):** el agente reconoce la interrupción y no repite pasos.

**Sin migración:** la tabla y la escritura ya existían; solo faltaba el lado de lectura.

### 2. Taxonomía de medios: allowlist por `content_class`

El detector deja de ser "audio OR keyword" y pasa a una **allowlist por clase**. Se
clasifica cada inbound en una `content_class` (`text/audio/image/video/location/
file/share/sticker/unknown`) con una matriz de política:

| clase | política (hoy) | placeholder fiel |
|---|---|---|
| `text` | agente maneja | el texto |
| `audio`/`image`/`video`/`location`/`file` | **escalar** | `[audio sin transcribir]`, `[el lead envió una imagen]`, … |
| `share` / `sticker` | anotar (agente sigue) | `[el lead compartió/respondió a una historia]`, `[el lead reaccionó / envió un sticker]` |
| `unknown` | **escalar** (fail-safe) | `[contenido no soportado]` |

Implementación (código TS, `@dm-api/shared`): `classifyMediaType`, `classifyMessageContent`,
`mediaPlaceholder`, `escalationReason`, `ESCALATING_CLASSES`. El `content_class` viaja
por el buffer (`BufferMessage`) y en el payload a n8n (`N8nDispatchMessage`), y
`Build Context` rinde el placeholder fiel (espejo de `mediaPlaceholder`). `media.type`
del schema de ManyChat pasa de `z.enum(...)` a `z.string()` para no perder tipos nuevos
de Instagram en el Zod parse. `NotificationKind` se amplía a las clases que escalan.

### 3. Persistir-pero-no-despachar en pausa

El chequeo `isSubscriberActive` se mueve a **después** de idempotencia + persistencia:
si el lead está pausado, el raw queda en el audit trail pero no se empuja al buffer ni
se encola BullMQ ni se escala (un humano ya atiende). Al reactivar, el agente ve el
hueco vía `handoff_state`. El endpoint `POST /admin/notifications/:id/resolve` acepta
una `note` opcional que se guarda como `summary` del handoff.

### 4. Autoservicio en `/settings`

- `tenant.config.media_policy` (override opcional de la matriz por clase) +
  `notification_keywords` editables vía **`PATCH /admin/tenants/:id/config`** (merge
  superficial, no reemplazo).
- Nueva pestaña **`/settings/notificaciones`** en el dashboard (keywords + matriz).

## Alternativas descartadas

- **Turnos sintéticos en `n8n_chat_histories`** (Decisión A): frágil y consume la
  ventana de memoria. Descartada a favor de B.
- **Mantener "audio OR keyword"** y seguir con el placeholder genérico: deja mentiras
  en la memoria y no escala medios accionables.

## Consecuencias

- El agente es consciente de escalados e intervenciones humanas en **todos** los turnos.
- Manejo de medios y escalado son ahora **la misma decisión** (la matriz).
- **Fase futura sin re-arquitectura:** cuando entren transcripción (Whisper/Groq) o
  visión, solo cambia la *política* de las filas `audio`/`image`/`video` (de `escalate`
  a `agent`) y el placeholder pasa a contenido real. El andamiaje (`handoff_state`,
  allowlist, placeholders, `content_class`) no cambia.
- Sin dependencias nuevas. Sin migración de DB (la columna `notifications.kind` es
  `text`; `media_policy` vive en el JSONB de `tenant.config`).
