# Implementación — Conciencia de handoff + taxonomía de medios (ADR-0023)

> **Estado:** código completo en la rama `feat/handoff-state-media-taxonomy`
> (lint + typecheck + test + build verdes). Pendiente: aplicar los nodos n8n en la
> UI + `make rebuild-api` antes de `make deploy`.
>
> Plan origen: [`handoff-memory-context-plan.md`](./handoff-memory-context-plan.md) ·
> Decisión arquitectónica: [`adr/0023-handoff-state-y-taxonomia-de-medios.md`](./adr/0023-handoff-state-y-taxonomia-de-medios.md)

Este documento resume **qué se cambió y dónde**, fase por fase. Las decisiones (Mecanismo
B, audio = escalar) ya estaban fijadas en el plan.

---

## Problema que resolvimos

1. El agente no se enteraba de sus propios escalados ni de los deterministas, ni de
   cuándo intervenía un humano: `Build Context` nunca leía `api.notifications`. Al
   retomar una conversación, "estaba perdido".
2. El detector de medios solo conocía `audio` + keywords; el resto (imagen, video,
   ubicación, archivo, sticker, share, desconocido) caía en el placeholder genérico
   `[contenido multimedia recibido — no se puede leer]`, una mentira permanente en la
   memoria del agente.
3. Al pausar a un lead, el inbound se descartaba **antes de persistir**: ni quedaba en
   el audit trail.
4. Las `notification_keywords` solo se editaban tocando el JSON del tenant a mano.

---

## Fase 1 — Conciencia del agente (`handoff_state`) · solo n8n + docs

No hubo cambios de código de runtime: la escritura en `api.notifications` ya existía.
Se documentó el **lado de lectura** para aplicar a mano en la UI de n8n:

| Entregable | Archivo |
|---|---|
| Nuevo nodo Postgres **Get Handoff State** (SQL + params) | `docs/n8n/nodes/00h-get-handoff-state.md` *(nuevo)* |
| **Build Context v6**: sección `handoff_state` + placeholders fieles | `docs/n8n/nodes/01-build-context.md` |
| **Combine Contexts**: 3er input (barrera de sincronización) | `docs/n8n/nodes/00g-combine-contexts.md` |
| **System prompt v9 / regla 8** (conciencia de interrupciones) | `docs/n8n/prompts/setter-v1.md`, `docs/n8n/nodes/00c-system-prompt.md` |
| Mapa de nodos actualizado | `docs/n8n/README.md` |

Forma de `handoff_state` en el `<context>`:

```json
"handoff_state": {
  "open_escalations": [{ "kind": "audio", "reason": "...", "age": "hace menos de 1 hora" }],
  "human_handled":    [{ "kind": "keyword", "resolved_by": "dashboard", "note": "...", "age": "hace 2 hora(s)" }],
  "last_human_action": "hace 2 hora(s)"
}
```

Solo aparece si hay escalados recientes (ventana 24 h, `LIMIT 10`). Degrada con elegancia.

---

## Fase 2 — Taxonomía de medios (allowlist por `content_class`) · código TS

El detector dejó de ser "audio OR keyword" y pasó a una **allowlist por clase**.

### Matriz (default; configurable por tenant en Fase 4)

| `content_class` | Política (hoy) | Placeholder fiel |
|---|---|---|
| `text` | agente maneja | el texto |
| `audio` | escalar | `[audio sin transcribir]` |
| `image` | escalar | `[el lead envió una imagen]` |
| `video` | escalar | `[el lead envió un video]` |
| `location` | escalar | `[el lead compartió una ubicación]` |
| `file` (incl. vCard) | escalar | `[el lead envió un archivo]` |
| `share` (reel/post/story reply) | anotar | `[el lead compartió/respondió a una historia]` |
| `sticker` / GIF / reacción | anotar | `[el lead reaccionó / envió un sticker]` |
| `unknown` | escalar (fail-safe) | `[contenido no soportado]` |

### Cambios

- **`packages/shared/src/schemas/manychat.ts`**: `CONTENT_CLASSES`, `ContentClass`,
  `ESCALATING_CLASSES`, mapa `RAW_MEDIA_TYPE_TO_CLASS`, `classifyMediaType`,
  `classifyMessageContent`, `mediaPlaceholder`, `escalationReason`. `media.type` →
  `z.string()` (no se pierden tipos nuevos de IG en el Zod parse).
- **`packages/shared/src/schemas/n8n-dispatch.ts`**: `content_class` en `N8nDispatchMessage`.
- **`apps/api/src/services/notifications.ts`**: `NotificationKind` ampliado a
  `audio|image|video|location|file|unknown|keyword|agent`.
- **`apps/api/src/services/debounce.ts`**: `content_class` opcional en `BufferMessage`.
- **`apps/api/src/routes/webhook-manychat.ts`**: `matchEscalationTrigger` reescrito como
  matriz (helper `effectiveAction`); los medios ganan sobre keyword; consulta
  `tenant.config.media_policy` y cae a la allowlist por defecto. `content_class` se
  calcula y se mete en el `BufferMessage`.
- **`apps/api/src/workers/process-batch.ts`**: placeholder fiel con `mediaPlaceholder()`;
  `content_class` incluido en el payload a n8n.
- **`apps/api/src/workers/notify.ts`**: headers de Telegram para las nuevas clases.
- **n8n (docs):** `buildMessagesText` de Build Context rinde el placeholder fiel (espejo
  de `mediaPlaceholder`).
- **Tests:** `apps/api/src/routes/webhook-manychat.test.ts` — 12 casos (escala por clase,
  no escala sticker/share, fail-safe `unknown`, keyword, override de `media_policy`).

---

## Fase 3 — Hueco de pausa · código TS

- **`apps/api/src/routes/webhook-manychat.ts`**: el chequeo `isSubscriberActive` se movió
  a **después** de idempotencia + `insertMessageRaw`. Si el lead está pausado, el raw
  queda en el audit trail pero **no** se empuja al buffer, no se encola BullMQ ni se
  escala (un humano ya atiende). Al reactivar, el agente ve el hueco vía `handoff_state`.
- **`apps/api/src/routes/admin/notifications.ts`** + **`services/notifications.ts`**:
  `note` opcional en `POST /admin/notifications/:id/resolve`; si viene, se guarda como
  `summary` del handoff (el agente la ve al retomar).

---

## Fase 4 — Autoservicio en `/settings` · API + dashboard

- **`packages/shared/src/schemas/tenant-config.ts`**: `MediaPolicySchema` /
  `MediaPolicyAction` (`escalate|annotate|agent`) + `media_policy` opcional.
- **`apps/api/src/routes/admin/tenants.ts`**: `PATCH /admin/tenants/:id/config`
  (merge superficial, subset editable: `notification_keywords`, `media_policy`).
- **`apps/api/src/services/tenants.ts`**: helper `updateTenantConfig` (merge, no reemplazo).
- **Dashboard:**
  - Nueva pestaña `/settings/notificaciones` (`app/(dashboard)/settings/notificaciones/page.tsx`).
  - Server action `_actions/notifications.ts` → `PATCH /tenants/:id/config`.
  - Componente `components/settings/NotificationsEditor.tsx` (keywords + matriz de medios).
  - El dashboard ahora depende de `@dm-api/shared` (agregado a `package.json`).

---

## Verificación

```bash
pnpm lint        # ✓
pnpm typecheck   # ✓ (4 paquetes)
pnpm test        # ✓ 44 API + 44 dashboard
pnpm build       # ✓ (incluye la ruta /settings/notificaciones)
```

**Pendiente de activación (manual):**
1. Aplicar en la UI de n8n: nodo *Get Handoff State*, *Build Context v6*, 3er input del
   Merge *Combine Contexts*, regla 8 del system prompt.
2. `make rebuild-api` antes de `make deploy` (cambió código API).
3. Sin migración de DB (todo en `notifications.kind` text + `tenant.config` JSONB).

**Fase futura (sin re-arquitectura):** cuando entren transcripción (Whisper/Groq) o
visión, solo cambia la *política* de las filas `audio`/`image`/`video` de la matriz (de
`escalate` a `agent`) y el placeholder pasa a contenido real. El andamiaje no cambia.
