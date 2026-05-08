# 08 · Observabilidad y dashboard

Como solo founder, observabilidad **no es opcional**. Cuando algo falla a las 3 a. m. necesitas que la respuesta esté en un dashboard, no en grep de logs.

## Pirámide

```
        ┌─────────────────┐
        │   Alertas       │   Telegram/email cuando algo crítico
        │   (Sentry,      │
        │    Grafana)     │
        ├─────────────────┤
        │   Dashboards    │   Grafana: estado del sistema
        │   (Grafana)     │
        ├─────────────────┤
        │   Métricas      │   Prometheus
        │   (Prometheus)  │
        ├─────────────────┤
        │   Trazas        │   OpenTelemetry → Tempo (opcional)
        │   (OTel)        │
        ├─────────────────┤
        │   Logs          │   Pino JSON → stdout → Loki/CloudWatch
        │   estructurados │
        └─────────────────┘
```

Para empezar (Sprint 1-2): logs + métricas + Grafana. Trazas se añaden cuando dolor lo justifica.

## Logging: Pino con correlation ID

```ts
// apps/api/src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'api',
    env: process.env.NODE_ENV,
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-mc-token"]', '*.password'],
    censor: '[REDACTED]',
  },
});
```

En cada request Fastify se genera un `correlation_id` (UUID) que viaja en:

- Header de respuesta `X-Correlation-Id`
- Cada log line dentro de la request
- Cuando se programa un job BullMQ, se guarda en `job.data.correlationId`
- Cuando se llama a n8n, se manda como header → n8n lo loggea → callback lo devuelve

Esto te permite hacer `grep <uuid>` en los logs y ver toda la cadena.

## Métricas (Prometheus)

```ts
// apps/api/src/lib/metrics.ts
import client from 'prom-client';

export const messagesReceived = new client.Counter({
  name: 'debounce_messages_received_total',
  help: 'Total messages received',
  labelNames: ['tenant', 'channel'],
});

export const turnDuration = new client.Histogram({
  name: 'turn_duration_ms',
  help: 'Time from dispatch to completed',
  labelNames: ['tenant', 'status'],
  buckets: [100, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000],
});

export const batchSize = new client.Histogram({
  name: 'debounce_batch_size',
  help: 'Number of messages per batch',
  labelNames: ['tenant'],
  buckets: [1, 2, 3, 5, 10, 20, 50],
});

export const dlqSize = new client.Gauge({
  name: 'dlq_size',
  help: 'Pending DLQ items',
  labelNames: ['tenant'],
});
```

Endpoint `/metrics` solo accesible desde la red interna (Prometheus en mismo Docker network).

### Métricas mínimas

Categorías y por qué:

| Categoría | Métricas | Por qué |
|---|---|---|
| **Tráfico** | messages_received_total, messages_duplicated_total, rate_limited_total | Saber el pulso |
| **Debounce** | batch_size (histogram), wait_duration_ms | Validar que el debounce funciona |
| **Turns** | dispatched_total, completed_total, failed_total, duration_ms | Salud del agente |
| **LLM** | input_tokens_total, output_tokens_total, cost_usd_total | Coste del negocio |
| **DLQ** | dlq_size, dlq_age_seconds | Salud del sistema |
| **HTTP** | request_duration_seconds, requests_total | Latencia API |
| **BullMQ** | jobs_active, jobs_waiting, jobs_failed, jobs_delayed | Salud de la cola |
| **Redis** | redis_memory_used, redis_keys_total | Capacidad |
| **Postgres** | pg_connections, pg_slow_queries | Salud DB |

## Dashboards Grafana (planos)

### Dashboard 1: "Operación"

```
┌───────────────────┬───────────────────┬───────────────────┐
│  Mensajes/min     │  Turns/min        │  DLQ pendientes   │
│  (line chart)     │  (line chart)     │  (single stat)    │
├───────────────────┼───────────────────┼───────────────────┤
│  Latencia turn p95│  Tasa fallos %    │  Coste LLM hoy    │
│  (gauge)          │  (gauge)          │  (single stat)    │
├───────────────────┴───────────────────┴───────────────────┤
│           Batch size distribution (heatmap)               │
├───────────────────────────────────────────────────────────┤
│           Tiempo de respuesta end-to-end (line)           │
└───────────────────────────────────────────────────────────┘
```

### Dashboard 2: "Por cliente (tenant)"

Variable Grafana `$tenant` para filtrar. Mismas métricas pero segmentadas.

### Dashboard 3: "Cola y workers"

- Bull Board embebido o link directo
- Jobs activos, retrasados, fallidos
- Workers vivos
- Lag de procesamiento

## Alertas mínimas

| Alerta | Condición | Severidad |
|---|---|---|
| API caída | `up{service="api"} == 0` por 1m | crítica |
| Worker caído | `up{service="api-worker"} == 0` por 1m | crítica |
| DLQ creciendo | `dlq_size > 50` por 5m | alta |
| Tasa de fallos | `rate(turn_failed_total[5m]) > 0.1` | alta |
| Latencia turn p95 | `> 30s` por 5m | media |
| Redis memoria | `> 80%` | media |
| Postgres conexiones | `> 80%` | media |
| Coste LLM diario | `> 50 USD` (configurable por tenant) | media |
| Sin mensajes recibidos | `rate(messages_received_total[10m]) == 0` en horario laboral | baja |

Canal: Telegram bot + email. Sentry para errores 5xx en código.

## Sentry para errores

Errores no esperados → Sentry. Configuración mínima:

```ts
import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // No enviar PII al breadcrumb
    return scrubPII(event);
  },
});
```

Atrapa errores en el handler, en workers BullMQ y en jobs programados.

## Dashboard admin web (Sprint 3)

Una pequeña SPA o app server-rendered en `apps/admin` que consume la API admin. Stack sugerido:

- **SvelteKit** o **Next.js** (SSR, simple)
- **Auth**: una clave maestra que genera JWT al login
- **Vistas**:
  - Lista de tenants con stats
  - Lista de subscribers paginada con búsqueda
  - Detalle de subscriber: timeline de mensajes y turns
  - Detalle de turn: payload, prompt, respuesta, coste
  - DLQ con botones de retry/resolve
  - Pausar/desbloquear subscriber
  - Editor de `tenants.config` (debounce_ms, model, etc.)

Sirve para cuando lo de n8n no basta y quieres una UI hecha a medida. **No imprescindible para el MVP**, n8n puede cubrir esto con workflows administrativos como mostramos en `06-n8n-integracion.md`.

## Bull Board

Plug-and-play. Añadir como ruta en Fastify:

```ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';

const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(processBatchQueue)],
  serverAdapter,
});

// Bajo auth admin
fastify.register(async (instance) => {
  instance.addHook('onRequest', adminAuthHook);
  await instance.register(serverAdapter.registerPlugin(), {
    prefix: '/admin/queues',
    basePath: '',
  });
});
```

Disponible en `https://admin.midominio.com/admin/queues` con auth.

## Logs centralizados (opcional, Sprint 3+)

Si la operación crece, añadir Loki + Promtail o Vector. Mientras tanto, `docker logs api --tail 1000` y stdout.
