# Capa de debounce ManyChat → Fastify → n8n

Sistema de buffering y orquestación de mensajes de Instagram DM (vía ManyChat) hacia un agente LLM ejecutado en n8n.

> Stack: **Fastify + BullMQ + PostgreSQL + Redis + n8n (queue mode)**, todo en el mismo VPS vía Docker Compose.

## Por qué existe este servicio

ManyChat dispara un webhook por **cada** mensaje que un usuario envía en Instagram DM. Un usuario humano rara vez termina su pensamiento en un solo mensaje: escribe en ráfagas de 3-5 mensajes en pocos segundos. Si dejamos que n8n responda a cada mensaje, el agente:

- Genera respuestas inconexas y se siente robótico.
- Multiplica el coste del LLM (una llamada por mensaje en vez de una por turno).
- Crea condiciones de carrera entre llamadas concurrentes a la API de envío.
- Excede los rate limits del Send API de Meta.

Esta capa **agrupa** los mensajes en ráfaga (debounce con timer reset), valida idempotencia, aplica rate limit por suscriptor, y entrega un único batch a n8n cuando el usuario termina de escribir.

## Lectura recomendada (en orden)

| # | Documento | Para qué |
|---|---|---|
| 01 | [`01-arquitectura.md`](./01-arquitectura.md) | Visión global, diagrama, flujo end-to-end |
| 02 | [`02-frontera-codigo-vs-n8n.md`](./02-frontera-codigo-vs-n8n.md) | **Qué va en código y qué en n8n** (lectura obligatoria) |
| 03 | [`03-modelo-de-datos.md`](./03-modelo-de-datos.md) | Esquema Postgres + claves Redis |
| 04 | [`04-debounce-y-turnos.md`](./04-debounce-y-turnos.md) | El algoritmo central: timer reset + token + lock |
| 05 | [`05-fastify-endpoints.md`](./05-fastify-endpoints.md) | Contrato de la API (público + admin) |
| 06 | [`06-n8n-integracion.md`](./06-n8n-integracion.md) | Cómo n8n consume y observa esta capa |
| 07 | [`07-docker-compose-y-deploy.md`](./07-docker-compose-y-deploy.md) | Deploy en el VPS |
| 08 | [`08-observabilidad-y-dashboard.md`](./08-observabilidad-y-dashboard.md) | Logs, métricas, admin web |
| 09 | [`09-seguridad-y-compliance.md`](./09-seguridad-y-compliance.md) | Firma, PII, ventana 24h Meta |
| 10 | [`10-roadmap-de-implementacion.md`](./10-roadmap-de-implementacion.md) | Plan por sprints para Claude Code |
| 11 | [`11-glosario-y-decisiones.md`](./11-glosario-y-decisiones.md) | ADRs y términos |
| 12 | [`12-manychat-setup-y-canales.md`](./12-manychat-setup-y-canales.md) | Configuración exacta de ManyChat (custom fields, flows, body) |
| 13 | [`13-funnel-y-agente.md`](./13-funnel-y-agente.md) | **Las 5 etapas del funnel**, agente, follow-ups, escalations |
| 14 | [`14-dashboard-y-metricas.md`](./14-dashboard-y-metricas.md) | Admin web, Grafana, queries de MSR/PRR/CSR/ABR, Calendly |

## Para Claude Code

Si estás leyendo esto desde Claude Code en el servidor, **antes de escribir cualquier línea de código**:

1. Lee `01`, `02` y `04` enteros. Son la columna vertebral conceptual.
2. Lee `10-roadmap-de-implementacion.md` para saber por qué sprint vamos.
3. Confirma con el usuario en qué sprint estamos antes de generar archivos.
4. **No mezclar concerns**: la capa Fastify es delgada (firma, idempotencia, debounce, rate, persistencia, fan-out). La lógica del agente vive en n8n.
5. Cualquier decisión no documentada aquí debe registrarse como ADR en `11-glosario-y-decisiones.md`.

## Convenciones del repo

```
/apps
  /api          ← Fastify (TypeScript)
  /admin        ← Dashboard web (opcional, Sprint 3)
/packages
  /shared       ← Tipos, schemas Zod compartidos
  /db           ← Migraciones Postgres + cliente
/n8n
  /workflows    ← Exports JSON de workflows versionados
/infra
  /docker       ← Dockerfiles y compose
  /scripts      ← Backups, migraciones, etc.
/docs           ← Estos markdowns
```

Lenguaje: **TypeScript estricto**. Runtime: **Node 20 LTS**. Gestor: **pnpm**.
