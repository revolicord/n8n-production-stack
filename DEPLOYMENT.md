# Guía de Despliegue en Producción

Guía completa para instalar esta plataforma en un servidor nuevo desde cero: infraestructura, DNS, cuentas externas, configuración de ManyChat, observabilidad y onboarding de tenants.

---

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Requisitos del servidor](#2-requisitos-del-servidor)
3. [Cuentas y servicios externos](#3-cuentas-y-servicios-externos)
4. [Configuración de DNS](#4-configuración-de-dns)
5. [Instalación inicial](#5-instalación-inicial)
6. [Configuración post-instalación](#6-configuración-post-instalación)
   - 6.1 [n8n — workflows del agente](#61-n8n--workflows-del-agente)
   - 6.2 [ManyChat — webhook y flows](#62-manychat--webhook-y-flows)
   - 6.3 [MinIO — activos de followups](#63-minio--activos-de-followups)
   - 6.4 [Telegram — escalado a humano](#64-telegram--escalado-a-humano)
   - 6.5 [LangSmith — observabilidad del agente](#65-langsmith--observabilidad-del-agente)
7. [Onboarding de un tenant nuevo](#7-onboarding-de-un-tenant-nuevo)
8. [Observabilidad propia del sistema](#8-observabilidad-propia-del-sistema)
9. [Operaciones día a día](#9-operaciones-día-a-día)
10. [Escalado](#10-escalado)
11. [Backups y recuperación](#11-backups-y-recuperación)
12. [Actualización de la plataforma](#12-actualización-de-la-plataforma)
13. [Resolución de problemas](#13-resolución-de-problemas)
14. [Referencia de variables de entorno](#14-referencia-de-variables-de-entorno)
15. [Referencia de secretos](#15-referencia-de-secretos)

---

## 1. Arquitectura general

```
Internet
  │
  ▼
Traefik v2.11 (reverse proxy + TLS Let's Encrypt)
  ├─ n8n.dominio.com          → n8n-main (UI) / n8n-webhook (/webhook/*)
  ├─ api.dominio.com          → API DM Setter (Fastify + BullMQ)
  ├─ dashboard.dominio.com    → Dashboard analítico (Next.js)
  ├─ minio.dominio.com        → MinIO S3 (activos)
  └─ minio-console.dominio.com → MinIO consola web
         │
         ▼ red interna Docker (n8n_internal)
  ┌──────┴──────────────────────────────────────────┐
  │  n8n-main  │  n8n-webhook  │  n8n-worker (×3)  │
  │  API       │  API-worker   │  Dashboard         │
  │  PostgreSQL│  Redis        │  MinIO             │
  └─────────────────────────────────────────────────┘

Flujo de mensajes:
ManyChat DM → POST /webhook/manychat
  → debounce Lua (Redis) → BullMQ job
  → worker adquiere turn lock
  → POST n8n /webhook/agent-run
  → agente LangGraph (Claude Sonnet 4.6) + herramientas
  → POST /admin/turn-completed → libera lock → persiste métricas
```

Toda la lógica LLM vive en n8n/agente. Todo el debounce/lock/cola vive en el código TypeScript. Nunca mezclar los dos lados (ver ADR-0001).

---

## 2. Requisitos del servidor

### Hardware mínimo

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disco | 40 GB SSD | 80 GB SSD |
| Ancho de banda | 100 Mbps | 1 Gbps |

> Con tráfico bajo (<500 conversaciones/día) el mínimo de 2 vCPU / 4 GB es suficiente.
> Por encima de 2.000 conversaciones/día, escalar a 4 vCPU / 8 GB y aumentar réplicas de workers.

### Sistema operativo

- **Ubuntu 22.04 LTS** (recomendado) o Debian 12
- Acceso SSH root o usuario con sudo

### Puertos requeridos

| Puerto | Protocolo | Propósito |
|--------|-----------|-----------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP → redirección HTTPS (ACME challenge) |
| 443 | TCP | HTTPS (todo el tráfico) |

> Solo 80 y 443 deben ser accesibles desde internet. El resto de puertos permanecen cerrados.

### Software previo

Docker es el único requisito. El script `setup.sh` lo instala automáticamente si no está presente.

```bash
# Verificar si Docker está instalado:
docker --version

# Si no está: instalar con una línea
curl -fsSL https://get.docker.com | sh
```

---

## 3. Cuentas y servicios externos

Antes de ejecutar la instalación, crea las siguientes cuentas y ten los tokens listos.

### 3.1 Anthropic (obligatorio — motor del agente)

El agente IA usa Claude Sonnet 4.6 como LLM principal.

1. Crear cuenta en [console.anthropic.com](https://console.anthropic.com)
2. Ir a **API Keys** → **Create Key**
3. Guardar el token: `sk-ant-api03-...`

**Coste:** pago por uso (tokens input/output). Presupuestar ~$10–50/mes por tenant activo según volumen.

### 3.2 GitHub (obligatorio — backup de workflows n8n)

Los workflows de n8n se respaldan automáticamente en Git al modificarlos en la UI.

1. Ir a GitHub → **Settings** → **Developer settings** → **Fine-grained personal access tokens**
2. Crear token nuevo:
   - **Resource owner:** organización o usuario
   - **Repository access:** solo el repo de backup
   - **Permissions → Contents:** Read and Write
3. Guardar el token: `github_pat_...`

**Variables necesarias:**
```
GITHUB_TOKEN=github_pat_...
GITHUB_OWNER=tu-org
GITHUB_REPO=n8n-production-stack
GITHUB_BRANCH=master
GITHUB_PATH=n8n-workflows
```

### 3.3 ManyChat (obligatorio — canal de Instagram DM)

ManyChat conecta Instagram DMs con este sistema mediante External Requests.

**Qué preparar antes de instalar:**
- Cuenta ManyChat activa con Instagram conectada
- Al menos un flow creado (aunque sea vacío) para pruebas
- Acceso a la sección **Flows → External Request** para configurar la URL después de instalar

**Qué se configura después de instalar** (sección 6.2):
- URL del webhook: `https://api.TU_DOMINIO.com/webhook/manychat`
- Header de autenticación: `X-MC-Token: <MC_WEBHOOK_TOKEN>`
- Convención de nombres de flows: `QC_{ETAPA}_{MEDIO}_{DESC}` (ADR-0016)

### 3.4 LangSmith (opcional — observabilidad técnica del agente)

LangSmith muestra la traza interna del grafo LangGraph: cada nodo, el call al LLM, tokens y latencia. Es útil para debug técnico pero no es necesario para que el sistema funcione.

> **Nota:** La observabilidad de negocio (qué dijo el agente, qué flows activó, métricas) siempre se guarda en Postgres (`api.agent_turn_traces`) independientemente de LangSmith.

1. Crear cuenta en [smith.langchain.com](https://smith.langchain.com)
   - Elegir región **EU** si estás en Europa (afecta el endpoint)
2. Ir a **Settings** → **API Keys** → **Create API Key**
3. Guardar la key: `lsv2_pt_...`

**Variables necesarias:**
```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=dm-agent
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
```

> Si te registraste en la región US, usa `https://api.smith.langchain.com` como endpoint.

### 3.5 Telegram (opcional — escalado a humano)

Cuando el agente detecta que un lead necesita atención humana, envía una notificación a Telegram con botones inline para gestionar el caso.

1. Abrir Telegram y buscar **@BotFather**
2. Enviar `/newbot` → seguir instrucciones → guardar el token: `1234567890:ABC-...`
3. Obtener el Chat ID del destino de notificaciones:
   - Abrir el bot [@userinfobot](https://t.me/userinfobot) o añadir el bot al grupo destino
   - Para grupos: añadir el bot al grupo, enviar un mensaje, obtener el chat_id con `@RawDataBot`
4. Después de instalar, ejecutar una vez: `bash scripts/telegram-set-webhook.sh`

> **CRÍTICO:** Después de instalar, el destinatario de las notificaciones debe **buscar el bot en Telegram y enviar `/start`** al menos una vez. Telegram bloquea bots que inician conversaciones sin que el usuario haya escrito primero (error 403). Sin este paso las alertas de escalado fallan silenciosamente.

### 3.6 Calendly (opcional — scheduling de citas)

Calendly se usa para que leads agenden llamadas o demos. El sistema inyecta la URL de Calendly en los followups automáticamente.

- No requiere cuenta API de pago para la integración básica
- Solo se necesita la URL de tu Calendly: `https://calendly.com/tu-usuario/nombre-evento`
- Se configura por tenant en el panel `/settings` después de instalar

---

## 4. Configuración de DNS

Antes de instalar, crea estos 5 registros A en tu proveedor de DNS apuntando a la IP del servidor.

| Subdominio | Tipo | Valor | Propósito |
|-----------|------|-------|-----------|
| `n8n.tudominio.com` | A | IP_DEL_SERVIDOR | Panel n8n + UI de workflows |
| `api.tudominio.com` | A | IP_DEL_SERVIDOR | API DM Setter (recibe webhooks de ManyChat) |
| `dashboard.tudominio.com` | A | IP_DEL_SERVIDOR | Panel de métricas y prospectos |
| `minio.tudominio.com` | A | IP_DEL_SERVIDOR | MinIO S3 (almacenamiento de activos) |
| `minio-console.tudominio.com` | A | IP_DEL_SERVIDOR | Consola web de MinIO |

**TTL recomendado:** 300 segundos (5 minutos) para instalación inicial. Subir a 3600 después de verificar.

> Los certificados SSL (Let's Encrypt) se generan automáticamente vía Traefik usando HTTP-01 challenge. Si el DNS no apunta correctamente al servidor, los certificados fallan y los servicios no arrancan. Verificar propagación DNS antes de instalar:
> ```bash
> dig +short n8n.tudominio.com
> # debe devolver la IP del servidor
> ```

---

## 5. Instalación inicial

```bash
# 1. Clonar el repositorio en el servidor
git clone https://github.com/revolicord/n8n-production-stack.git /root/n8n-production-stack
cd /root/n8n-production-stack

# 2. Ejecutar el script de instalación interactivo
bash scripts/setup.sh
```

El script hace todo automáticamente:
1. Verifica prerequisitos (Docker, puertos, Swarm)
2. Pide los subdominios y el email para SSL
3. Pide el GitHub PAT para backup de workflows
4. Pide tokens de Telegram (opcional)
5. **Genera automáticamente** todas las contraseñas y tokens internos
6. Escribe el archivo `.env`
7. Inicializa Docker Swarm si no está activo
8. Crea la red overlay `traefik-public`
9. Instala Traefik v2.11
10. Construye las imágenes Docker locales (`dm-api:local`, `dm-dashboard:local`)
11. Despliega el stack completo
12. Inicializa los buckets de MinIO

**Duración:** 5–10 minutos en primer despliegue.

### Verificar que todo está corriendo

```bash
make status
# Todos los servicios deben mostrar Replicas: 1/1 (o N/N)

curl https://api.TU_DOMINIO.com/healthz
# { "status": "ok" }

curl https://n8n.TU_DOMINIO.com/healthz
# { "status": "ok", ... }
```

> Si algún servicio no arranca: `docker stack ps n8n --no-trunc` muestra el error exacto.

---

## 6. Configuración post-instalación

### 6.1 n8n — workflows del agente

Acceder al panel de n8n: `https://n8n.TU_DOMINIO.com`

En el primer acceso, n8n pide crear un usuario administrador. Guarda esas credenciales.

#### Workflow `agent-run` (obligatorio)

Este workflow recibe cada turno del agente y ejecuta el LLM.

1. En n8n → **New Workflow**
2. Consultar la especificación completa en `docs/n8n/README.md` y `docs/09_AGENT_TOOLS_AND_INTEGRATIONS.md`
3. El webhook trigger debe responder en: `https://n8n.TU_DOMINIO.com/webhook/agent-run`
4. El workflow necesita estas credenciales de n8n:
   - **PostgreSQL:** para el Chat Memory (tabla `n8n_chat_histories`, misma DB que la app)
   - **HTTP Request (callback):** Bearer token = `N8N_CALLBACK_TOKEN` del `.env`
   - **Anthropic:** `ANTHROPIC_API_KEY`

Consultar los nodos de código en `docs/n8n/nodes/` para el código exacto de cada Code node.

#### Workflow `followup-runner` (recomendado)

Cron que corre cada `FOLLOWUP_INTERVAL_MINUTES` minutos para avanzar secuencias de followup.

1. Trigger: Schedule (cada 5 minutos o el valor configurado)
2. Llama a `POST /admin/followup-run` en la API interna

### 6.2 ManyChat — webhook y flows

#### Configurar el webhook en ManyChat

1. En ManyChat → **Automations** → tu flow de captura de DMs
2. Añadir acción **External Request (HTTP POST)**
3. Configurar:
   - **URL:** `https://api.TU_DOMINIO.com/webhook/manychat`
   - **Method:** POST
   - **Headers:**
     - `Content-Type: application/json`
     - `X-MC-Token: <valor de MC_WEBHOOK_TOKEN en tu .env>`
4. **Body:** incluir todos los campos del subscriber que el agente necesita:
   ```json
   {
     "subscriber_id": "{{subscriber id}}",
     "first_name": "{{first name}}",
     "last_name": "{{last name}}",
     "ig_username": "{{ig username}}",
     "ig_user_id": "{{ig user id}}",
     "text": "{{last input text}}",
     "instagram_context": "{{instagram context}}"
   }
   ```
   Ver la especificación exacta del payload en `docs/06_DM_API_MANYCHAT_PAYLOAD.md` (ADR-0006).

#### Convención de nombres de flows (ADR-0016)

Todos los flows que el agente puede activar deben seguir el patrón:

```
QC_{ETAPA}_{MEDIO}_{DESCRIPCION}_{VARIANTE}
```

Ejemplos:
- `QC_AWARENESS_VIDEO_VSL_A` — video de VSL para lead en etapa awareness, variante A
- `QC_CONSIDERATION_TEXT_OBJECION_PRECIO` — texto para objeción de precio en consideration
- `QC_DECISION_FLOW_CERRAR_DEMO` — flow de cierre de demo en etapa decision

Después de crear los flows en ManyChat, sincronizar con la DB:
```bash
curl -X POST https://api.TU_DOMINIO.com/tenants/{slug}/tools/sync \
  -H "Authorization: Bearer <ADMIN_JWT_SECRET>"
```

O desde el panel `/settings` → pestaña **Flows**.

### 6.3 MinIO — activos de followups

MinIO almacena imágenes y videos que se usan en followups tipo `content` (ADR-0018).

**Acceder a la consola:** `https://minio-console.TU_DOMINIO.com`
- Usuario: valor de `MINIO_ROOT_USER` en `.env` (por defecto `minio_admin`)
- Contraseña: valor de `MINIO_ROOT_PASSWORD` en `.env`

**Buckets creados automáticamente:**
- `n8n-data` — almacenamiento binario interno de n8n (privado)
- `assets` — activos públicos para followups y dashboard (lectura pública)

**Subir activos para followups:**
1. Acceder a la consola MinIO → bucket `assets`
2. Crear carpeta por tenant: `/{slug}/`
3. Subir imágenes/videos de los followups
4. La URL pública será: `https://minio.TU_DOMINIO.com/assets/{slug}/archivo.jpg`
5. Usar esa URL en el template del followup (campo `media_url`)

> Las imágenes de followup tipo `content` usan ManyChat Send Content con la URL de MinIO.
> El bucket `assets` es públicamente accesible (solo lectura) por diseño — no subir contenido sensible.

### 6.4 Telegram — escalado a humano

Si configuraste Telegram durante el setup, quedan dos pasos manuales:

**Paso A: Registrar el webhook de callbacks**
```bash
bash scripts/telegram-set-webhook.sh
# Registra https://api.TU_DOMINIO.com/webhook/telegram con el secreto correcto
# Solo se ejecuta una vez (o cuando cambia el dominio/secreto)
```

**Paso B: El destinatario debe enviar `/start` al bot**
- Buscar el bot en Telegram por su username
- Enviar `/start`
- Sin este paso, Telegram devuelve 403 Forbidden en el primer mensaje del bot

**Verificar que funciona:**
```bash
# En la DB, forzar un estado de "pausa" en un subscriber de prueba
# y esperar que llegue la notificación en el chat de Telegram
```

**Configuración por tenant** (override del chat_id global):
Editar `tenant.config.telegram_chat_id` desde el panel `/settings` → **Configuración** → campo `telegram_chat_id`.

### 6.5 LangSmith — observabilidad técnica del agente

Si tienes `LANGSMITH_TRACING=true` en el `.env`, las trazas del agente se envían automáticamente a LangSmith sin ninguna configuración adicional en el código.

**Verificar que las trazas llegan:**
1. Hacer una prueba en ManyChat (enviar un DM de test)
2. Ir a `https://eu.smith.langchain.com` → proyecto `dm-agent`
3. Debe aparecer un run nuevo con los nodos del grafo

**Qué se ve en cada run:**
- Árbol de nodos: `assemble_context` → `prepare_prompt` → `understand` → `flow_engine` → `execute_actions` → `respond`
- El call a Anthropic: input (system prompt + mensajes), output (plan del LLM), tokens, latencia
- Errores con stack trace si algún nodo falla
- Metadata: `thread_id = conversation_id` para filtrar por conversación

**Gotcha importante:**
LangSmith ≥ 0.2 **solo** lee variables `LANGSMITH_*`. Las variables antiguas `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY` se ignoran silenciosamente. Si no llegan trazas, verificar que los nombres de vars son exactamente `LANGSMITH_TRACING` y `LANGSMITH_API_KEY`.

---

## 7. Onboarding de un tenant nuevo

Un "tenant" es un cliente de la agencia (por ejemplo, una empresa que usa el setter).

### 7.1 Crear el tenant en la DB

```bash
make seed-tenant SLUG=nombre-cliente N8N_WORKFLOW_URL=https://n8n.TU_DOMINIO.com/webhook/agent-run
# SLUG: identificador único, solo minúsculas y guiones (ej: quantum-creators)
# NAME es opcional: make seed-tenant SLUG=qc NAME="Quantum Creators" N8N_WORKFLOW_URL=...
```

Esto crea la fila en `api.tenants` con configuración base.

### 7.2 Importar flows y persona del agente

```bash
make seed-agent-config SLUG=nombre-cliente
# Lee los archivos de configuración desde packages/db/seeds/tenant-configs/{slug}/
# Importa: funnel_stages, stage_flows, followup_templates, agent persona
```

Para un tenant nuevo, primero crear los archivos de seed:
```
packages/db/seeds/tenant-configs/nombre-cliente/
├── flows.json        # definición de flows QC_* del tenant
├── persona.json      # system prompt, tono, estilo del agente
└── stages.json       # etapas del funnel y configuración de cada una
```

Ver ejemplos en `packages/db/seeds/tenant-configs/` para el formato exacto.

### 7.3 Verificar desde el dashboard

Acceder a `https://dashboard.TU_DOMINIO.com`
- Contraseña: valor de `PANEL_PASSWORD` en `.env`
- Ir a `/settings` para configurar flows, stages, persona y followups por tenant

### 7.4 Probar el flujo completo

```bash
# Smoke test completo (requiere pnpm instalado localmente)
pnpm smoke:manychat
# Envía mensajes de prueba: texto, flows, followups y notificación Telegram
# y verifica que llegan a la API y se procesan correctamente
```

O manualmente:
```bash
curl -X POST https://api.TU_DOMINIO.com/webhook/manychat \
  -H "Content-Type: application/json" \
  -H "X-MC-Token: <MC_WEBHOOK_TOKEN>" \
  -d '{
    "subscriber_id": "test-123",
    "first_name": "Test",
    "ig_username": "test_user",
    "ig_user_id": "123456",
    "text": "Hola, me interesa el servicio",
    "tenant_slug": "nombre-cliente"
  }'
```

---

## 8. Observabilidad propia del sistema

El sistema tiene dos capas de observabilidad complementarias.

### 8.1 Observabilidad de negocio — `agent_turn_traces`

La tabla `api.agent_turn_traces` guarda la traza legible de cada turno del agente. No depende de LangSmith y nunca sale PII de la infraestructura.

```sql
-- Ver los últimos turnos de un tenant
SELECT
  t.id,
  t.mode,
  t.status,
  t.input->>'messages' AS user_message,
  t.reasoning,
  t.flow_path,
  t.response_texts,
  t.metrics,
  t.error,
  t.created_at
FROM api.agent_turn_traces t
WHERE t.tenant_id = '<uuid>'
ORDER BY t.created_at DESC
LIMIT 20;

-- Ver conversaciones activas
SELECT
  s.ig_username,
  c.status,
  c.last_user_msg_at,
  ls.stage_id as etapa_actual
FROM api.conversations c
JOIN api.subscribers s ON s.id = c.subscriber_id
LEFT JOIN api.lead_stages ls ON ls.subscriber_id = s.id
WHERE c.tenant_id = '<uuid>'
  AND c.status = 'open'
ORDER BY c.last_user_msg_at DESC;

-- Métricas de tokens por tenant (últimas 24h)
SELECT
  t.tenant_id,
  COUNT(*) as turns,
  SUM((t.metrics->>'input_tokens')::int) as tokens_in,
  SUM((t.metrics->>'output_tokens')::int) as tokens_out,
  AVG((t.metrics->>'total_ms')::int) as avg_ms
FROM api.agent_turn_traces t
WHERE t.created_at > NOW() - INTERVAL '24 hours'
GROUP BY t.tenant_id;
```

**Desde el dashboard:** `https://dashboard.TU_DOMINIO.com` → sección Conversaciones muestra el mismo data en interfaz visual.

### 8.2 Observabilidad técnica — LangSmith

Ver sección [6.5](#65-langsmith--observabilidad-técnica-del-agente). Complementa `agent_turn_traces` con la vista interna del grafo.

### 8.3 Logs de servicios en tiempo real

```bash
make logs-api          # Fastify — peticiones entrantes, errores de webhook
make logs-api-worker   # BullMQ — procesamiento de debounce, dispatch a n8n, LangGraph
make logs-main         # n8n main — workflows, credenciales, eventos del scheduler
make logs-webhook      # n8n webhook — recepción de llamadas desde la API
make logs-worker       # n8n workers — ejecución de workflow jobs
make logs-dashboard    # Next.js dashboard
make logs-minio        # MinIO — accesos S3
```

Buscar errores en todos los servicios:
```bash
docker service logs n8n_api 2>&1 | grep -i error | tail -50
docker service logs n8n_api-worker 2>&1 | grep -i error | tail -50
```

### 8.4 Salud de los servicios

```bash
make status
# Lista todos los servicios con réplicas actuales vs deseadas
# Ejemplo de salida sana:
# ID    NAME                 REPLICAS  IMAGE
# xxx   n8n_api              1/1       dm-api:local
# xxx   n8n_api-worker       1/1       dm-api:local
# xxx   n8n_dashboard        1/1       dm-dashboard:local
# xxx   n8n_minio            1/1       minio/minio:latest
# xxx   n8n_n8n-main         1/1       n8nio/n8n:latest
# xxx   n8n_n8n-webhook      1/1       n8nio/n8n:latest
# xxx   n8n_n8n-worker       3/3       n8nio/n8n:latest
# xxx   n8n_postgres         1/1       postgres:16-alpine
# xxx   n8n_redis            1/1       redis:7-alpine
# xxx   traefik              1/1       traefik:v2.11

# Healthcheck de la API:
curl -sf https://api.TU_DOMINIO.com/healthz && echo "OK"

# Healthcheck de n8n:
curl -sf https://n8n.TU_DOMINIO.com/healthz && echo "OK"
```

### 8.5 Métricas de Redis y colas BullMQ

```bash
# Conectar a Redis
docker exec -it $(docker ps -qf name=n8n_redis) redis-cli -a <REDIS_PASSWORD>

# Ver colas BullMQ
KEYS bullmq:*
LLEN bullmq:dm-turns:wait

# Ver debounce buffers activos
KEYS *:debounce:*
```

### 8.6 Limpieza de trazas antiguas

Las trazas acumuladas en `agent_turn_traces` pueden ocupar espacio significativo.

```bash
# Borrar trazas de más de 30 días (ajustar según política de retención)
make prune-traces DAYS=30

# Ver cuánto espacio ocupan las trazas
docker exec -it $(docker ps -qf name=n8n_postgres) \
  psql -U n8n -c "SELECT pg_size_pretty(pg_total_relation_size('api.agent_turn_traces'));"
```

---

## 9. Operaciones día a día

### Verificar estado general

```bash
make status
```

### Ver logs en tiempo real

```bash
make logs-api-worker   # el más importante: aquí se procesa todo
make logs-api          # errores de webhook entrante
```

### Exportar conversación para análisis/tuning

```bash
make export-conversation CONV=<conversation_uuid>
# Genera el bundle en ./agent-tuning-out/
```

### Acceso directo a la DB

```bash
docker exec -it $(docker ps -qf name=n8n_postgres) psql -U n8n -d n8n
# Tablas propias: prefijo api.*
# \dt api.*    lista todas las tablas
```

### Acceso directo a Redis

```bash
docker exec -it $(docker ps -qf name=n8n_redis) redis-cli -a <REDIS_PASSWORD>
```

---

## 10. Escalado

### Escalar workers n8n (capacidad de workflow paralela)

```bash
make scale-workers N=5   # escalar a 5 réplicas
make scale-workers N=3   # volver a 3 (default)
```

### Escalar la API (capacidad de webhook / BullMQ)

```bash
make scale-api N=2   # 2 réplicas de api + api-worker
```

> `api-worker` siempre escala junto con `api` porque comparten la misma carga.

### Límites de concurrencia por configuración

| Variable | Default | Efecto |
|----------|---------|--------|
| `WORKER_CONCURRENCY` | 10 | Jobs paralelos en BullMQ worker |
| `N8N_CONCURRENCY_PRODUCTION_LIMIT` | 10 | Workflows paralelos por réplica n8n-worker |
| `RATE_PER_MINUTE` | 20 | Rate limit de webhooks por subscriber |
| `DEBOUNCE_MS` | 15000 | Ventana de debounce (ms) |

---

## 11. Backups y recuperación

### Backup manual

```bash
make backup
# Hace pg_dump de PostgreSQL + mirror de MinIO
# Guarda en /var/backups/n8n/ con timestamp
# Retiene últimos 7 días automáticamente
```

### Backup automático (cron recomendado)

```bash
# Añadir al crontab del servidor:
crontab -e

# Backup diario a las 2am:
0 2 * * * cd /root/n8n-production-stack && bash scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

### Restaurar PostgreSQL

```bash
# Identificar el backup más reciente:
ls -lt /var/backups/n8n/postgres/

# Restaurar (¡destructivo — para servidor nuevo o recuperación de desastre!):
gunzip < /var/backups/n8n/postgres/n8n_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i $(docker ps -qf name=n8n_postgres) psql -U n8n -d n8n
```

### Dato crítico: `N8N_ENCRYPTION_KEY`

Esta clave cifra todas las credenciales de n8n (API keys, tokens de integraciones). **Si se pierde o cambia, todas las credenciales guardadas en n8n quedan inutilizables** y hay que reintroducirlas manualmente en cada integración.

- Guardarla en un gestor de secretos (1Password, Vault, etc.) desde el primer día
- Está en `.env` como `N8N_ENCRYPTION_KEY`
- Nunca rotarla en un sistema en producción sin un plan de migración

---

## 12. Actualización de la plataforma

### Actualizar n8n a la última versión

```bash
make update
# Hace docker service update --image n8nio/n8n:latest en main + webhook + workers
# Rolling update: sin downtime
```

### Actualizar código propio (API / Dashboard / Agente)

```bash
# El flujo normal es via /ship (integrado con CI):
# /ship "descripción del cambio"

# O manualmente:
git pull origin master
make rebuild-api        # reconstruye dm-api:local y actualiza servicios api + api-worker
make rebuild-dashboard  # reconstruye dm-dashboard:local y actualiza dashboard
```

### Aplicar migraciones de DB

```bash
make migrate
# Corre el servicio one-shot api-migrate que aplica las migraciones Drizzle pendientes
# Idempotente: seguro de correr múltiples veces
```

> **Siempre** correr `make migrate` después de un `git pull` que incluya cambios en `packages/db/drizzle/`.

---

## 13. Resolución de problemas

### El servicio no arranca / está en estado `Failed`

```bash
docker stack ps n8n --no-trunc
# Muestra el error exacto de cada task fallida

# Ejemplo: ver por qué n8n-main no arranca:
docker service ps n8n_n8n-main --no-trunc
```

### Los certificados SSL no se generan

1. Verificar que el DNS apunta al servidor: `dig +short n8n.TU_DOMINIO.com`
2. Verificar que el puerto 80 está abierto: `curl -v http://n8n.TU_DOMINIO.com`
3. Forzar que Traefik reintente: `docker service update --force traefik`
4. Ver logs de Traefik: `docker service logs traefik`

### Los webhooks de ManyChat no llegan

1. Verificar health de la API: `curl https://api.TU_DOMINIO.com/healthz`
2. Verificar el token: debe coincidir `MC_WEBHOOK_TOKEN` en `.env` con el header en ManyChat
3. Ver logs: `make logs-api` durante el envío de prueba
4. Revisar idempotencia: mensajes duplicados se ignoran (hash SHA-256 en Redis)

### El agente no responde / workflow n8n no dispara

1. Verificar que el workflow `agent-run` está **activo** (no desactivado en n8n UI)
2. Ver logs del worker: `make logs-api-worker`
3. Verificar que `N8N_BASE_URL` en `.env` apunta a `http://n8n-webhook:5678` (nombre de servicio interno)
4. Verificar conectividad interna: desde un contenedor de la misma red, `curl http://n8n-webhook:5678/healthz`

### Trazas de LangSmith no llegan

1. Verificar variables en `.env`: nombres exactos `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`
2. Verificar que son los nombres nuevos (no `LANGCHAIN_*` — se ignoran silenciosamente)
3. Verificar el endpoint: si tu cuenta es EU, usar `https://eu.api.smith.langchain.com`
4. Las vars se pasan al contenedor `api-worker` — reiniciarlo después de cambiar `.env`:
   ```bash
   docker service update --force n8n_api-worker
   ```

### Notificaciones de Telegram no llegan

1. Verificar que el webhook está registrado: `bash scripts/telegram-set-webhook.sh`
2. Verificar que el destinatario ha enviado `/start` al bot (error 403 si no lo ha hecho)
3. Ver logs: `make logs-api-worker | grep telegram`
4. Test directo: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

### La DB está llena / queries lentas

```bash
# Ver tamaño de tablas:
docker exec -it $(docker ps -qf name=n8n_postgres) \
  psql -U n8n -c "
    SELECT schemaname, tablename,
           pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
    FROM pg_tables
    WHERE schemaname = 'api'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
  "

# Las tablas más grandes suelen ser:
# - api.agent_turn_traces → limpiar con: make prune-traces DAYS=30
# - api.messages_raw      → política de retención manual
# - n8n_chat_histories    → gestionar desde n8n (ejecuciones → limpiar)
```

---

## 14. Referencia de variables de entorno

Todas las variables se configuran en `.env` (generado por `setup.sh`). Ver también `.env.example` con comentarios.

### Dominios

| Variable | Ejemplo | Obligatorio |
|----------|---------|-------------|
| `N8N_HOST` | `n8n.tudominio.com` | Sí |
| `API_HOST` | `api.tudominio.com` | Sí |
| `DASHBOARD_HOST` | `dashboard.tudominio.com` | Sí |
| `MINIO_DOMAIN` | `minio.tudominio.com` | Sí |
| `MINIO_CONSOLE_DOMAIN` | `minio-console.tudominio.com` | Sí |
| `TRAEFIK_NETWORK` | `traefik-public` | Sí (default: `traefik-public`) |

### Base de datos y caché

| Variable | Ejemplo | Obligatorio |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | `<generado>` | Sí |
| `REDIS_PASSWORD` | `<generado>` | Sí |

> `DATABASE_URL` y `REDIS_URL` se construyen internamente a partir de las contraseñas. No hace falta definirlas.

### n8n

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `N8N_ENCRYPTION_KEY` | Clave AES-256 para credenciales de n8n. **NUNCA cambiar.** | Sí |

### MinIO

| Variable | Default | Obligatorio |
|----------|---------|-------------|
| `MINIO_ROOT_USER` | `minio_admin` | Sí |
| `MINIO_ROOT_PASSWORD` | `<generado>` | Sí |
| `MINIO_ENDPOINT` | `http://minio:9000` | Sí |
| `MINIO_ACCESS_KEY` | igual a `MINIO_ROOT_USER` | Sí |
| `MINIO_SECRET_KEY` | igual a `MINIO_ROOT_PASSWORD` | Sí |
| `MINIO_BUCKET_ASSETS` | `assets` | Sí |
| `MINIO_PUBLIC_URL` | `https://<MINIO_DOMAIN>` | Sí |

### Autenticación y tokens

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `MC_WEBHOOK_TOKEN` | Header `X-MC-Token` que ManyChat envía en cada webhook | Sí |
| `N8N_CALLBACK_TOKEN` | Bearer token que n8n usa para llamar a `/admin/*` | Sí |
| `ADMIN_JWT_SECRET` | Clave de firma para JWTs del panel de administración | Sí |
| `PANEL_PASSWORD` | Contraseña del dashboard analítico | Sí |
| `PANEL_JWT_SECRET` | Clave JWT del dashboard | Sí |
| `API_IMAGE` | `dm-api:local` | Sí |
| `DASHBOARD_IMAGE` | `dm-dashboard:local` | Sí |

### GitHub backup

| Variable | Ejemplo | Obligatorio |
|----------|---------|-------------|
| `GITHUB_TOKEN` | `github_pat_...` | Sí |
| `GITHUB_OWNER` | `revolicord` | Sí |
| `GITHUB_REPO` | `n8n-production-stack` | Sí |
| `GITHUB_BRANCH` | `master` | Sí |
| `GITHUB_PATH` | `n8n-workflows` | Sí |

### Agente IA

| Variable | Default | Obligatorio |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Sí (si `engine=agent`) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | No |
| `AGENT_TIMEOUT_MS` | `60000` | No |

### Telegram (opcional)

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather | No |
| `TELEGRAM_DEFAULT_CHAT_ID` | Chat/grupo destino de notificaciones | No |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto para verificar callbacks de botones | No |
| `PAUSE_REMINDER_HOURS` | Cada cuántas horas recordar leads pausados (0=off) | No (default: 6) |
| `FOLLOWUP_INTERVAL_MINUTES` | Frecuencia del runner de followups (0=off) | No (default: 5) |

### LangSmith (opcional)

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `LANGSMITH_TRACING` | `true` para activar | No |
| `LANGSMITH_API_KEY` | `lsv2_pt_...` | No |
| `LANGSMITH_PROJECT` | `dm-agent` | No |
| `LANGSMITH_ENDPOINT` | EU: `https://eu.api.smith.langchain.com` | No |

---

## 15. Referencia de secretos

Tabla de todos los secretos del sistema, cómo se generan, si se pueden rotar y qué impacto tiene hacerlo.

| Secreto | Generación | Rotable | Impacto de rotar |
|---------|-----------|---------|-----------------|
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32` | **NUNCA** | Rompe todas las credenciales guardadas en n8n |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` | Sí | Actualizar `.env` + redesplegar |
| `REDIS_PASSWORD` | `openssl rand -base64 32` | Sí | Actualizar `.env` + redesplegar |
| `MINIO_ROOT_PASSWORD` | `openssl rand -base64 32` | Sí | Actualizar `.env` + `MINIO_SECRET_KEY` + redesplegar |
| `MC_WEBHOOK_TOKEN` | `openssl rand -hex 32` | Sí | Actualizar header en ManyChat inmediatamente |
| `N8N_CALLBACK_TOKEN` | `openssl rand -hex 32` | Sí | Actualizar credencial en n8n workflow |
| `ADMIN_JWT_SECRET` | `openssl rand -hex 64` | Sí | Invalida todas las sesiones activas del dashboard |
| `PANEL_PASSWORD` | `openssl rand -base64 24` | Sí | Cambio inmediato, sin impacto en datos |
| `PANEL_JWT_SECRET` | `openssl rand -hex 64` | Sí | Invalida sesiones del dashboard |
| `GITHUB_TOKEN` | GitHub UI | Sí | El backup de workflows deja de funcionar hasta rotar |
| `ANTHROPIC_API_KEY` | Anthropic Console | Sí | Crear nueva key primero, luego revocar la anterior |
| `TELEGRAM_BOT_TOKEN` | @BotFather `/token` | Sí | Re-registrar webhook después de rotar |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 16` | Sí | Re-ejecutar `telegram-set-webhook.sh` |
| `LANGSMITH_API_KEY` | LangSmith UI | Sí | Solo afecta observabilidad técnica |

### Dónde guardar los secretos

- **Desarrollo:** archivo `.env` local (nunca committear)
- **Producción:** archivo `.env` en el servidor con permisos 600 (`chmod 600 .env`)
- **Recomendado para equipos:** HashiCorp Vault, AWS Secrets Manager, o secretos de Docker Swarm

```bash
# Proteger el .env en producción:
chmod 600 /root/n8n-production-stack/.env
chown root:root /root/n8n-production-stack/.env
```

---

## Checklist de instalación completa

### Antes de instalar
- [ ] Servidor Ubuntu 22.04 / Debian 12 con 4+ GB RAM
- [ ] Puertos 80 y 443 abiertos en el firewall del VPS
- [ ] 5 registros DNS apuntando a la IP del servidor (y propagados)
- [ ] Cuenta Anthropic con API key lista
- [ ] Repositorio GitHub y PAT con permisos Contents: Read/Write
- [ ] (Opcional) Bot de Telegram creado con @BotFather
- [ ] (Opcional) Cuenta LangSmith con API key

### Instalación
- [ ] `bash scripts/setup.sh` completado sin errores
- [ ] `make status` muestra todos los servicios en `1/1`
- [ ] `curl https://api.TU_DOMINIO.com/healthz` devuelve `{"status":"ok"}`
- [ ] Acceso a `https://n8n.TU_DOMINIO.com` con certificado SSL válido
- [ ] Acceso a `https://dashboard.TU_DOMINIO.com` con la contraseña del `.env`

### Post-instalación
- [ ] Crear usuario administrador en n8n (primer acceso)
- [ ] Crear workflow `agent-run` en n8n y verificar que el webhook responde
- [ ] `make seed-tenant SLUG=...` para el primer tenant
- [ ] `make seed-agent-config SLUG=...` para importar flows y persona
- [ ] Configurar External Request en ManyChat (URL + `X-MC-Token` header)
- [ ] Sincronizar flows: `POST /tenants/{slug}/tools/sync` o desde `/settings`
- [ ] (Telegram) `bash scripts/telegram-set-webhook.sh` + enviar `/start` al bot
- [ ] (LangSmith) Verificar que llegan trazas al proyecto `dm-agent`
- [ ] `make backup` y configurar cron de backup diario
- [ ] Test end-to-end: enviar DM de prueba desde Instagram → respuesta del agente

### Validación final
- [ ] El agente responde a mensajes de prueba en Instagram
- [ ] Las trazas aparecen en `api.agent_turn_traces`
- [ ] El dashboard muestra conversaciones y métricas
- [ ] Las notificaciones de escalado llegan a Telegram (si está configurado)
- [ ] Los workflows de n8n se respaldan automáticamente en GitHub
