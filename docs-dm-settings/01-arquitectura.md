# 01 · Arquitectura global

## Componentes

Todo corre en un único VPS vía Docker Compose, en una red privada interna. Solo dos servicios se exponen públicamente: el reverse proxy (Caddy/Traefik) y, opcionalmente, el dashboard admin.

```
                         Internet
                            │
                            │ HTTPS
                            ▼
                    ┌───────────────┐
                    │  Caddy/Traefik │  (TLS, reverse proxy)
                    └───┬───────┬───┘
                        │       │
        ┌───────────────┘       └────────────────┐
        ▼                                        ▼
┌──────────────────┐                    ┌──────────────────┐
│   api (Fastify)  │                    │   n8n  (main)    │
│   - /webhook/*   │                    │   - editor UI    │
│   - /admin/*     │                    │   - webhook URL  │
│   - /healthz     │                    │     pública si    │
└─┬────────────┬───┘                    │     hace falta   │
  │            │                        └────────┬─────────┘
  │            │                                 │
  │            │      ┌──────────────────┐       │
  │            └─────▶│ api-worker       │       │
  │                   │ (BullMQ worker,  │       │
  │                   │  procesa batches)│       │
  │                   └─────────┬────────┘       │
  │                             │                │
  │                             ▼                ▼
  │                  ┌────────────────────┐ ┌──────────────┐
  │                  │   n8n callback     │ │ n8n-worker-1 │
  │                  │   POST /webhook    │ │ n8n-worker-2 │
  │                  │   /agent-run      │ │   ...        │
  │                  └────────────────────┘ └──────┬───────┘
  │                                                │
  │     ┌──────────────────────────────────────────┘
  │     │ POST /admin/turn-completed (callback)
  ▼     ▼
┌──────────────────────┐    ┌──────────────────────┐
│      PostgreSQL       │    │        Redis          │
│  - api schema         │    │  - debounce:*         │
│  - n8n schema         │    │  - buffer:*           │
│                       │    │  - lock:*             │
│  (compartido pero     │    │  - rate:*             │
│   con schemas         │    │  - bull:* (BullMQ)    │
│   separados)          │    │  - n8n queue          │
└──────────────────────┘    └──────────────────────┘
```

### Servicios Docker

| Servicio | Imagen | Función |
|---|---|---|
| `caddy` | `caddy:2` | TLS y reverse proxy |
| `api` | `./apps/api` | Fastify HTTP server (webhooks + admin API) |
| `api-worker` | `./apps/api` (mismo build, comando distinto) | Procesa jobs BullMQ (batches, fan-out a n8n, callbacks ManyChat) |
| `n8n-main` | `n8nio/n8n` | UI y orquestación |
| `n8n-webhook` | `n8nio/n8n` (con `--webhook`) | Recibe webhooks dedicados |
| `n8n-worker` (xN) | `n8nio/n8n` (con `--worker`) | Ejecuta workflows |
| `postgres` | `postgres:16` | DB compartida (schemas separados) |
| `redis` | `redis:7-alpine` | Cola + cache + debounce state |
| `grafana` (opcional) | `grafana/grafana` | Dashboards |
| `prometheus` (opcional) | `prom/prometheus` | Métricas |

> Postgres y Redis **se comparten** entre la API y n8n para simplificar operación. Son dos schemas distintos en Postgres y prefijos distintos en Redis. Esto es seguro y reduce coste/operación; ver `07-docker-compose-y-deploy.md` para los detalles.

## Flujo end-to-end (turno completo)

```
1. Usuario envía DM "hola" en Instagram
2. Meta → ManyChat (recibe el evento)
3. ManyChat → External Request (POST) → https://api.midominio.com/webhook/manychat
4. Fastify api:
   a. Verifica X-MC-Token header
   b. Calcula hash de idempotencia: sha256(channel + subscriber_id + message_id)
   c. SET idemp:{hash} 1 NX EX 86400 → si ya existía, descarta y responde 200
   d. INSERT messages_raw (audit)
   e. Rate limit check (token bucket por subscriber)
   f. RPUSH buffer:{tenant}:{subscriber} <mensaje serializado>
   g. SET debounce:{tenant}:{subscriber} <token-uuid> EX 8
   h. BullMQ.add('process-batch', {tenant, subscriber, token}, {delay: 8000, jobId: token})
   i. Responde 200 OK con cuerpo vacío en <100 ms
5. Usuario escribe 4 mensajes más en 6 s. Cada uno repite el paso 4:
   - Cada nuevo mensaje genera nuevo token UUID
   - SET debounce sobreescribe → token anterior es inválido
   - Se programa nuevo job de BullMQ con nuevo jobId (delay 8s)
6. Tras 8 s sin actividad, el job más reciente se ejecuta en api-worker:
   a. GET debounce:{tenant}:{subscriber} → ¿coincide con el token del job?
      - NO → llegó otro mensaje después, este job es obsoleto, abort
      - SÍ → continúa
   b. SET lock:turn:{tenant}:{subscriber} 1 NX EX 90 → si falla, abort (turno en curso)
   c. LRANGE + DEL buffer:{tenant}:{subscriber} → batch completo de mensajes
   d. INSERT turns con status='pending'
   e. POST n8n: http://n8n-webhook:5678/webhook/agent-run
      con: {tenant, subscriber, batch, conversation_id, turn_id, callback_url}
   f. n8n responde 202 Accepted (no espera al LLM)
7. n8n ejecuta el workflow del agente:
   - Hidrata memoria (Redis Chat Memory node)
   - Llama al LLM con tools
   - Llama a ManyChat API para enviar la respuesta al usuario
   - POST callback a la api: /admin/turn-completed
     con: {turn_id, response_text, tokens, cost_usd, status}
8. api recibe callback:
   a. UPDATE turns SET status='completed', response_text=..., tokens=...
   b. DEL lock:turn:{tenant}:{subscriber}
   c. Si hay buffer pendiente (mensajes que llegaron durante el lock),
      programar nuevo job inmediatamente.
9. El usuario ve la respuesta en Instagram.
```

### Por qué este patrón asíncrono

- **ManyChat External Request tiene timeout duro de 10 segundos.** Si esperamos al LLM, fallamos siempre.
- Solución: la API responde 200 inmediatamente, y la respuesta al usuario se envía con la **API de ManyChat** (`/fb/sending/sendFlow` o `setCustomField` + flow trigger) desde el flujo del agente en n8n.
- Esto desacopla por completo la latencia del LLM del webhook entrante.

## Principios arquitectónicos

1. **Stateless en la capa HTTP.** Toda la API se puede escalar horizontalmente; el estado vive en Postgres y Redis.
2. **Workers separados del HTTP server.** El proceso `api` no procesa BullMQ. El proceso `api-worker` no acepta HTTP. Aislar fallos.
3. **Idempotencia en cada paso.** Webhooks repetidos → mismo resultado. Jobs reprogramados → mismo resultado.
4. **Multi-tenant desde día 1.** Toda clave Redis y toda fila Postgres lleva `tenant_id`.
5. **Frontera código/n8n explícita.** Lee `02-frontera-codigo-vs-n8n.md`.
6. **n8n no es la fuente de verdad.** Postgres lo es. n8n puede ser reinstalado y reimportado sin perder datos.
7. **Observabilidad desde MVP.** Logs JSON estructurados con `correlation_id` desde el primer commit.

## Qué NO hace este servicio

- No mantiene la lógica del agente LLM (eso es n8n).
- No conoce los prompts (los versiona quien quiera, normalmente n8n credentials + repo aparte).
- No habla con Meta directamente (ManyChat es el adaptador).
- No hace transcripción de audio ni análisis de imagen (tools del agente en n8n).
- No es un CRM. Si necesitas CRM real, integras con uno externo desde n8n.
