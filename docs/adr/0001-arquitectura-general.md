# ADR-0001: Arquitectura General del Stack n8n en Producción

**Status:** Proposed  
**Date:** 2026-05-01  
**Deciders:** Equipo Revolicord

---

## Y-Statement

> _In the context of_ deploying n8n for production use with ManyChat/Instagram webhooks,  
> _facing_ the need for high reliability, webhook throughput, and binary file storage,  
> _we decided_ to run n8n in **queue mode** with a dedicated webhook processor, 3 execution workers, PostgreSQL, Redis, and MinIO,  
> _to achieve_ horizontal scalability and separation of concerns between request handling and workflow execution,  
> _accepting_ higher operational complexity compared to a single-process n8n deployment.

---

## Contexto

Necesitamos recibir webhooks de ManyChat (Instagram DM triggers) de forma fiable y ejecutar workflows de automatización sin bloquear la recepción de nuevas peticiones. El dominio objetivo es `paneln8n.revolicord.com`.

---

## Decisión: Topología de servicios

```
Internet
   │
   ▼
[Reverse Proxy / TLS]   ← paneln8n.revolicord.com
   │
   ├──/webhook/*  ──────► [n8n-webhook]  (recibe HTTP, encola jobs)
   │                            │
   └── /* (UI, API) ──────► [n8n-main]   (UI, trigger manager)
                                │
                         [Redis Queue]
                         /     |     \
               [worker-1] [worker-2] [worker-3]
                    (ejecutan los workflows)
                         \     |     /
                       [PostgreSQL]
                       [MinIO / S3]
```

### ⚠️ Corrección conceptual crítica

> **Los workers NO reciben tráfico HTTP directamente.**

El flujo correcto es:
1. HTTP llega al reverse proxy.
2. El proxy enruta `/webhook/*` → `n8n-webhook` y el resto → `n8n-main`.
3. Ambos procesos (`main` y `webhook`) **encolan jobs** en Redis.
4. Los **workers** consumen de la cola Redis y ejecutan los workflows.
5. Workers no exponen puertos HTTP (salvo healthcheck opcional con `QUEUE_HEALTH_CHECK_ACTIVE=true`).

La escala de workers afecta la **capacidad de ejecución**, no la capacidad de recibir webhooks.

---

## Servicios y responsabilidades

| Servicio | Proceso n8n | Puerto interno | Responsabilidad |
|---|---|---|---|
| `n8n-main` | `n8n start` | 5678 | UI web, REST API, trigger manager |
| `n8n-webhook` | `n8n webhook` | 5678 | Recibe webhooks HTTP, encola en Redis |
| `n8n-worker` ×3 | `n8n worker` | — (sin HTTP) | Ejecuta workflows desde la cola |
| `postgres` | — | 5432 | Base de datos principal |
| `redis` | — | 6379 | Cola de jobs Bull |
| `minio` | — | 9000/9001 | Almacenamiento binario (archivos, imágenes) |
| Reverse proxy | Caddy/Nginx | 80/443 | TLS, routing, entrada única |

---

## Bugs identificados en el compose de referencia

| # | Problema | Impacto | Corrección |
|---|---|---|---|
| 1 | `N8N_BINARY_DATA_MODE` no existe | MinIO **no se activa** | → `N8N_DEFAULT_BINARY_DATA_MODE` |
| 2 | `N8N_EXTERNAL_STORAGE_S3_BUCKET` no existe | MinIO **no se activa** | → `N8N_EXTERNAL_STORAGE_S3_BUCKET_NAME` |
| 3 | `N8N_EXTERNAL_STORAGE_S3_REGION` no existe | Error silencioso | → `N8N_EXTERNAL_STORAGE_S3_BUCKET_REGION` |
| 4 | `N8N_EXTERNAL_STORAGE_S3_SECRET_KEY` no existe | Auth falla | → `N8N_EXTERNAL_STORAGE_S3_ACCESS_SECRET` |
| 5 | `N8N_EXTERNAL_STORAGE_S3_ENDPOINT` no existe | Conexión falla | → `N8N_EXTERNAL_STORAGE_S3_HOST` + `N8N_EXTERNAL_STORAGE_S3_PROTOCOL` |
| 6 | `deploy.replicas: 3` ignorado en docker-compose | Sólo arranca 1 worker | Usar `--scale` o workers explícitos |
| 7 | `command: n8n worker` duplicado en `n8n-worker` | Comportamiento indefinido | Eliminar duplicado |
| 8 | Worker healthcheck apunta a `localhost:5678` | Healthcheck falla (workers no exponen 5678 por defecto) | Activar con `QUEUE_HEALTH_CHECK_ACTIVE=true` o eliminar healthcheck |
| 9 | Sin reverse proxy en el compose | ManyChat requiere HTTPS; sin TLS no funciona | Agregar Caddy o Nginx+certbot |
| 10 | Bucket `n8n-data` no se crea automáticamente | n8n falla al escribir archivos | Agregar job de inicialización MinIO |

---

## Preguntas abiertas — necesito tus respuestas para continuar

### 1. Deploy target _(crítica — cambia toda la estructura del archivo)_
- **A)** Docker Compose puro (`docker compose up`) en un VPS
- **B)** EasyPanel (el comentario en tu ejemplo lo sugiere, pero EasyPanel tiene su propio formato)
- **C)** Docker Swarm

### 2. Reverse proxy
- **A)** **Caddy** — TLS automático con Let's Encrypt, configuración mínima _(recomendado)_
- **B)** **Nginx + certbot** — más control, más pasos manuales
- **C)** Ya tienes Traefik corriendo en el servidor

### 3. Infraestructura del servidor
- ¿Cuánta RAM y CPUs? (3 workers + main + webhook + postgres + redis + minio necesitan ~6–8 GB mínimo)
- ¿Sistema operativo? (Ubuntu 22.04, Debian, etc.)

### 4. DNS
- ¿`paneln8n.revolicord.com` ya apunta a la IP del servidor?

### 5. MinIO console
- **A)** Solo acceso interno (más seguro) — accedes via SSH tunnel
- **B)** Expuesto en un subdominio, ej. `minio.revolicord.com`

### 6. Backups
- ¿Incluimos scripts de backup para PostgreSQL + MinIO o lo dejamos fuera de scope?

### 7. Zona horaria
- ¿`America/Mexico_City` es correcta?

---

## Consecuencias

**Positivas:**
- Webhooks de ManyChat/Instagram nunca bloquean ejecuciones largas.
- Workers escalables independientemente del frontend.
- Archivos binarios (imágenes de Instagram) en MinIO, no en disco del container.
- Un único punto de entrada (reverse proxy) simplifica SSL y firewall.

**Negativas/Trade-offs:**
- Más servicios = mayor superficie de monitoreo.
- Requiere que el bucket MinIO exista antes de que n8n arranque (job de init).
- La encryption key DEBE ser idéntica en todos los procesos n8n (main, webhook, workers).

---

## ADRs relacionados (pendientes de aprobación de este)

- ADR-0002: Cola de jobs con Redis y configuración de workers
- ADR-0003: Almacenamiento binario con MinIO
- ADR-0004: Reverse proxy y terminación TLS
- ADR-0005: Integración de webhooks ManyChat/Instagram
