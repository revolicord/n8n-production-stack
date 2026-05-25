# 06 · Integración con n8n

Aquí respondemos directamente la pregunta: **¿n8n puede ver lo que pasa en Fastify o queda inaccesible?**

Respuesta corta: **n8n tiene tres puertas de acceso bien definidas. La capa Fastify no es una caja negra.**

## Las tres puertas

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   n8n  ──┬──▶  HTTP Request al endpoint público de Fastify   │
│          │     (workflow del agente, callbacks, retries)     │
│          │                                                    │
│          ├──▶  Postgres node (lectura directa)               │
│          │     (turns, conversations, DLQ, stats)            │
│          │                                                    │
│          └──▶  Redis node (lectura directa, debug)           │
│                (buffer en curso, locks, rate)                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Regla de oro**: Postgres/Redis para **leer**, API Fastify para **mutar**.

Esto evita que n8n rompa atomicidad escribiendo directamente en claves de debounce o haciendo updates SQL que se salten validaciones de la API.

## Puerta 1: HTTP Request a la API (el caso principal)

### Workflow del agente — entrada y callback

n8n tiene **un workflow principal** que recibe el batch desde Fastify y devuelve el resultado vía callback. Es el flujo "happy path" del agente.

Estructura mínima:

```
[Webhook trigger /agent-run]
   ↓
[Set: extraer turnId, batch, conversation, subscriber]
   ↓
[Postgres: GET tenant config (modelo, prompt_version)]
   ↓
[AI Agent node con Postgres Chat Memory + tools]
   ↓
[Set: format response, calculate tokens]
   ↓
[HTTP Request: ManyChat sendFlow]    (envía al usuario)
   ↓
[HTTP Request: POST {api}/admin/turn-completed]   (cierra turno)
```

Detalles:
- El webhook trigger responde **inmediatamente 202** al recibir, antes de procesar. En n8n: nodo `Respond to Webhook` configurado en modo "Immediately" al inicio.
- El callback final usa el `callback_url` y `callback_token` que vienen en el payload — la API los provee, no se hardcodean en n8n. Esto permite rotar tokens sin tocar workflows.
- Si el LLM falla, igualmente se hace callback con `status: "failed"` y `error: "..."` — la API libera el lock y registra DLQ.

### Workflows administrativos

n8n puede tener workflows **independientes** que llaman a la API de admin para hacer cosas. Ejemplos:

**Workflow "DLQ Daily Review"** (cron diario 9am):
```
[Cron 9am]
   ↓
[HTTP GET {api}/admin/dlq?status=pending]
   ↓
[Si hay items: Slack message con resumen]
   ↓
[Si > 10 items: email a admin]
```

**Workflow "Pausar usuario tras 3 quejas"** (subworkflow llamado por agente):
```
[Trigger: When called by another workflow]
   ↓
[HTTP POST {api}/admin/subscribers/:id/pause]
   body: { until: "+24h", reason: "complaint detected" }
   ↓
[Postgres INSERT en api.audit_log]
```

**Workflow "Retry DLQ item"** (manual trigger en n8n UI):
```
[Manual trigger con input dlq_id]
   ↓
[HTTP POST {api}/admin/dlq/:id/retry]
   ↓
[Mostrar resultado]
```

Esto es la **clave**: n8n tiene UI, n8n tiene cron, n8n tiene visualización. La API es el "kernel" que ejecuta acciones de forma segura.

## Puerta 2: Postgres node (lectura directa)

n8n incluye nodo Postgres nativo. Configurar credenciales con un usuario **read-only** en el schema `api`:

```sql
CREATE USER n8n_reader WITH PASSWORD '...';
GRANT USAGE ON SCHEMA api TO n8n_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO n8n_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT SELECT ON TABLES TO n8n_reader;
```

Lo que n8n puede consultar libremente:

| Caso de uso | Query típica |
|---|---|
| Ver últimos turns de un usuario | `SELECT * FROM api.turns WHERE subscriber_id = $1 ORDER BY started_at DESC LIMIT 10` |
| Calcular coste mensual por tenant | `SELECT tenant_id, SUM(cost_usd) FROM api.turns WHERE started_at >= date_trunc('month', now()) GROUP BY 1` |
| Encontrar conversaciones abandonadas | `SELECT * FROM api.conversations WHERE status='open' AND last_user_msg_at < now() - interval '24 hours'` |
| Top usuarios por mensajes | `SELECT subscriber_id, count(*) FROM api.messages_raw WHERE received_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 20` |

Esto te permite construir **dashboards o automatizaciones de negocio enteramente en n8n**, sin que la API tenga que exponer cada métrica como endpoint.

## Puerta 3: Redis node (lectura directa, debug)

Útil para depurar en vivo. Casos:

- **¿Está bloqueado un usuario?** `GET lock:turn:{tenant}:{subscriber}` — si devuelve un valor, hay turn en curso.
- **¿Qué hay en el buffer ahora?** `LRANGE buffer:{tenant}:{subscriber} 0 -1`
- **¿Cuántos jobs en BullMQ?** `LLEN bull:process-batch:wait` (con cuidado: no son las claves canónicas, BullMQ usa varias).

**No escribir desde n8n**. Si necesitas mutar (purgar buffer, soltar lock), usa la API:

- `DELETE /admin/subscribers/:id/buffer` → limpia buffer + reset debounce
- `POST /admin/subscribers/:id/unlock` → libera lock manualmente (solo emergencia)

## Patrón típico: panel admin en n8n

n8n permite crear "workflows internos" que son básicamente herramientas para el founder. Ejemplo:

**Workflow "Inspector de usuario"** (manual, con form input):

```
[Manual trigger con input: tenant_slug + ig_username]
   ↓
[Postgres: SELECT subscriber + last 5 turns]
   ↓
[Redis: GET buffer + lock + debounce token]
   ↓
[HTTP GET {api}/admin/subscribers/:id]   (estado completo)
   ↓
[Set: formatear como Markdown]
   ↓
[Output: tabla legible]
```

Lo abres desde la UI de n8n y tienes una "consola" del usuario.

## Convenciones de comunicación API ↔ n8n

| Concepto | Convención |
|---|---|
| Trigger del agente | Webhook `POST` en n8n, URL fija configurada por tenant en `tenants.config.n8n_workflow_url` |
| Callback de n8n | `POST {api}/admin/turn-completed` con `Authorization: Bearer ${N8N_CALLBACK_TOKEN}` |
| Payload entrante a n8n | Incluye siempre `turn_id`, `callback_url`, `callback_token`, `tenant`, `subscriber`, `messages[]`, `conversation` |
| Identificadores | Siempre UUIDs nuestros, no IDs de ManyChat directamente, para que n8n no se acople al formato externo |
| Encoding | JSON UTF-8, ISO8601 para fechas |
| Versionado | Cabecera `X-Schema-Version: v1`. Si rompemos contrato, `v2` y migramos workflows |

## ¿Qué hacer cuando algo va mal?

**El agente responde mal**:
1. Mira `api.turns` para encontrar el turn_id.
2. Abre la ejecución de n8n con `n8n_execution_id`.
3. Itera el prompt en n8n.
4. No tocas código.

**Llegan mensajes duplicados al usuario**:
1. Mira logs de Fastify (`correlation_id` desde `messages_raw.id`).
2. Busca duplicados en `api.turns` con mismo `batch_message_ids`.
3. Probablemente race condition en el lock — issue en código.

**Mensajes que no llegan al usuario**:
1. `SELECT * FROM api.turns WHERE status='failed' OR (status='dispatched' AND completed_at IS NULL)`.
2. `SELECT * FROM api.dead_letter_queue WHERE resolved_at IS NULL`.
3. Workflow de n8n con error en su ejecución → revisar n8n executions UI.

**El usuario quiere que un humano le atienda**:
1. n8n detecta intent → llama a `POST /admin/subscribers/:id/pause`.
2. Notifica al equipo (Slack/email vía n8n).
3. El humano responde manualmente desde Instagram/inbox de ManyChat.
4. n8n llama a `POST /admin/subscribers/:id/unpause` cuando termina.

## Limitaciones del patrón

- **n8n no puede hacer debounce desde fuera**: el debounce vive en código y es opaco para n8n. Si quieres tunear la ventana, cambias `tenants.config.debounce_ms` en Postgres y la API la lee. n8n puede hacer la UI para editarlo.
- **n8n no puede ver jobs en cola de BullMQ con un nodo nativo**. Si quieres visualizarlos, la opción más sencilla es **Bull Board** (`@bull-board/express`) montado como subruta de Fastify (`/admin/queues`) con auth.
- **Reintentos automáticos los hace BullMQ**, no n8n. n8n solo puede pedir reintento manual vía API.

## Bull Board

Recomendado: añadir Bull Board al admin de Fastify. Da una UI HTML que ve cualquier admin con su JWT, mostrando:

- Jobs activos, completados, fallidos, retrasados
- Reintento manual con click
- Inspección de payload

```
Admin web (Sprint 3)        Bull Board               Grafana
http://admin.x.com          http://admin.x.com/      http://admin.x.com/
                            queues                    grafana
```

Todo detrás del mismo Traefik con auth.

> Nota: Bull Board y la mayoría de los endpoints `/admin/*` que se mencionan en este documento (dlq, pause, stats) son **diseño, no implementados** hoy. Endpoints reales en [05-api-fastify-endpoints](05-api-fastify-endpoints.md); estado en [`status.md`](../status.md).
