# 05 · Endpoints de la DM Setter API

Contrato HTTP **real** de la API Fastify. Las rutas se registran en [`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts). Esta capa es delgada: no contiene lógica de agente (ver [02-frontera-codigo-vs-n8n](02-frontera-codigo-vs-n8n.md)).

## Autenticación

| Mecanismo | Dónde | Quién lo usa |
|---|---|---|
| Sin auth | `/healthz`, `/readyz` | health checks de Docker/Traefik |
| Header `X-MC-Token` | `/webhook/manychat` | ManyChat (token compartido, timing-safe) |
| `Authorization: Bearer <N8N_CALLBACK_TOKEN>` | todo lo demás | n8n (callbacks y tools) |

> **No hay JWT admin ni roles todavía.** Todo lo que llama n8n usa el mismo `N8N_CALLBACK_TOKEN`. El esquema de JWT/roles que aparecía en versiones previas de este doc es diseño, no está implementado.

## Endpoints implementados

| Método | Ruta | Auth | Para qué |
|---|---|---|---|
| GET | `/healthz` | — | Liveness (`{status:'ok', uptime}`) |
| GET | `/readyz` | — | Readiness: comprueba Postgres + Redis (200 / 503) |
| POST | `/webhook/manychat` | X-MC-Token | Webhook entrante de ManyChat (la vía principal) |
| POST | `/admin/turn-completed` | Bearer | Callback de n8n al cerrar un turno |
| POST | `/admin/leads/:subscriberId/stage` | Bearer | n8n avanza/cambia la etapa de un lead (`set_stage`) |
| GET | `/tenants/:slug/tools` | Bearer | Lista de flows de ManyChat del tenant (para Build Context) |
| POST | `/tenants/:slug/tools/sync` | Bearer | Sincroniza flows de ManyChat → `stage_flows` |

### `POST /webhook/manychat`

La ruta caliente. Secuencia (ver [`webhook-manychat.ts`](../../apps/api/src/routes/webhook-manychat.ts)):

1. Verifica `X-MC-Token` (timing-safe) → 401 si falla.
2. Valida el body con `ManyChatWebhookSchema` → 400 si inválido.
3. Resuelve el tenant por `tenant_slug`. Si no existe o está inactivo → **200 silencioso** (para que ManyChat no reintente).
4. Upsert del subscriber. Si está `paused`/`blocked` → 200 silencioso.
5. Idempotencia: hash de `(tenant_id, subscriber_id, external_message_id)` con `SET NX` (TTL 24 h). Duplicado → 200.
6. Persiste `messages_raw` (audit-first, **antes** del ACK).
7. Push al buffer Redis (Lua atómico) + nuevo token de debounce.
8. Encola job BullMQ con `delay = debounce_ms`. Si el buffer supera el hard limit, encola un dispatch forzado.
9. **200 OK** inmediato.

El body lo define `ManyChatWebhookSchema` (`packages/shared/src/schemas/manychat.ts`). Detalle de la configuración de ManyChat y del payload en [10-manychat-setup](10-manychat-setup.md).

### `POST /admin/turn-completed`

Callback que n8n hace al final del workflow del agente. Body validado con `TurnCompletedSchema` (`packages/shared/src/schemas/turn-completed.ts`):

```json
{
  "turn_id": "uuid",
  "status": "completed",
  "response_text": "Hola! Sí, te paso un hueco…",
  "input_tokens": 1234,
  "output_tokens": 156,
  "cost_usd": 0.000234,
  "model": "claude-sonnet-4-6",
  "prompt_version": "setter-v1",
  "n8n_execution_id": "12345",
  "error": null
}
```

Efecto: actualiza el `turn`, toca `conversations.last_bot_msg_at`, **libera el lock** (solo si es el turno dueño) y, si llegaron mensajes durante el lock, **reencola** un nuevo turno (`post_lock_drain`). Responde **204**.

### `POST /admin/leads/:subscriberId/stage`

La tool `set_stage` del agente. Body:

```json
{ "new_stage": "MS", "reason": "user_confirmed_video", "evidence": "ya lo vi, interesante", "turn_id": "uuid" }
```

Upsert en `lead_stages` + fila en `stage_transitions` (con `reason` y `agent_evidence`). Si la etapa no cambia, responde `{changed:false}`. Respuesta 200 `{stage, changed, from}`. (`reason`, `evidence`, `turn_id` son opcionales.)

> Nota: el archivo es `routes/admin/set-stage.ts`, pero la **ruta** es `/admin/leads/:subscriberId/stage`. La validación de transiciones válidas (rechazar saltos como A→C) es lógica de diseño descrita en [07-funnel-y-agente](07-funnel-y-agente.md); revisa el código para ver qué se valida hoy.

### `GET /tenants/:slug/tools` · `POST /tenants/:slug/tools/sync`

El registro de flows de ManyChat. `GET` lee `fb/page/getFlows` de ManyChat, filtra por el prefijo del tenant (`QC_` por defecto), parsea el nombre según la convención y cachea 5 min en Redis. `POST .../sync` hace UPSERT en `stage_flows` (a `pending_ns`, requiere aprobación SQL; `?force=true` solo fuera de producción). Detalle completo en [09-flow-registry-manychat](09-flow-registry-manychat.md).

## Validación y errores

Toda request se valida con **Zod**; los schemas compartidos viven en `packages/shared/src/schemas/` (`manychat.ts`, `turn-completed.ts`, `n8n-dispatch.ts`, `tenant-config.ts`) y se reusan en API + n8n dispatch.

Formato de error unificado: `{ "error": { "code": "...", "details": ... } }`. Códigos usados: `UNAUTHORIZED` (401), `INVALID_PAYLOAD` (400), `NOT_FOUND` (404). El webhook responde **200** incluso en casos no-procesables (tenant desconocido, pausado, duplicado) para evitar reintentos agresivos de ManyChat; reserva 4xx para auth/validación.

## Endpoints PENDIENTES (diseño, no implementados)

Estos aparecen en diseños del funnel/dashboard pero **aún no existen**. Ver [`status.md`](../status.md) y [13-dashboard-y-metricas](13-dashboard-y-metricas.md):

- `GET /admin/leads`, `GET /admin/leads/:id` — listado/detalle de leads por etapa.
- `GET /admin/stats/funnel|transitions|costs` — métricas MSR/PRR/CSR/ABR y coste LLM.
- `GET/POST /admin/notifications/...` — centro de notificaciones (escalado a humano).
- `POST /webhook/calendly` — webhook de Calendly que mueve C→D.
- `GET/POST/PUT/DELETE /admin/funnel-stages|.../flows|.../followups` — CRUD del funnel.
- `POST /admin/conversations/:id/archive` — archivar conversación.
- `/metrics` (Prometheus), DLQ admin, pausa/unpausa de subscriber, round-robin de closers.

No hay endpoint `/metrics` ni dashboard servido por la API hoy.
