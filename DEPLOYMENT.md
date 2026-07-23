# Guía de Despliegue en Producción

Guía completa para instalar esta plataforma en un servidor nuevo desde cero: infraestructura, DNS, cuentas externas, configuración de ManyChat, Calendly, Telegram, observabilidad y onboarding de tenants.

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
   - 6.5 [Calendly — agendamiento de leads](#65-calendly--agendamiento-de-leads)
   - 6.6 [LangSmith — observabilidad técnica del agente](#66-langsmith--observabilidad-técnica-del-agente-opcional)
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
  ├─ panel.dominio.com           → n8n-main (UI) / n8n-webhook (/webhook/*)
  ├─ api.dominio.com             → API DM Setter (Fastify + BullMQ)
  ├─ dashboard.dominio.com       → Dashboard analítico (Next.js)
  ├─ minio.dominio.com           → MinIO S3 (activos)
  └─ minio-console.dominio.com   → MinIO consola web
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

Calendly → POST /webhook/calendly
  → identifica lead por utm_content
  → persiste booking → cancela followups de prospección
  → inyecta ChangeStage(→D, cascade) → agente confirma y avanza etapa
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

Antes de ejecutar la instalación, crea las siguientes cuentas y ten los tokens a mano.

Las marcadas como **OBLIGATORIO** bloquean el funcionamiento del sistema si no están configuradas.

### 3.1 Anthropic — motor del agente IA (OBLIGATORIO)

El agente usa Claude Sonnet 4.6 como LLM principal.

1. Crear cuenta en [console.anthropic.com](https://console.anthropic.com)
2. Ir a **API Keys** → **Create Key**
3. Guardar el token: `sk-ant-api03-...`

**Coste:** pago por uso (~$10–50/mes por tenant activo según volumen).

### 3.2 GitHub — backup de workflows n8n (OBLIGATORIO)

Los workflows de n8n se respaldan automáticamente en Git al modificarlos en la UI.

1. Ir a GitHub → **Settings** → **Developer settings** → **Fine-grained personal access tokens**
2. Crear token nuevo:
   - **Repository access:** solo el repo de backup
   - **Permissions → Contents:** Read and Write
3. Guardar el token: `github_pat_...`

### 3.3 ManyChat — canal de Instagram DM (OBLIGATORIO)

ManyChat conecta Instagram DMs con este sistema mediante External Requests.

**Qué preparar antes de instalar:**
- Cuenta ManyChat activa con Instagram conectada
- Al menos un flow creado para pruebas (aunque sea vacío)
- Acceso a **Flows → External Request** para configurar después de instalar

**Qué se configura después de instalar** (sección 6.2):
- URL del webhook: `https://api.TU_DOMINIO.com/webhook/manychat`
- Header: `X-MC-Token: <MC_WEBHOOK_TOKEN>`
- Convención de nombres de flows: `QC_{ETAPA}_{MEDIO}_{DESC}` (ADR-0016)

### 3.4 Telegram — escalado a humano (OBLIGATORIO)

Cuando el agente detecta que un lead necesita atención humana, envía una notificación a Telegram con botones inline para gestionar el caso. El sistema no puede notificar escalados sin esto.

1. Abrir Telegram → buscar **@BotFather** → enviar `/newbot`
2. Seguir instrucciones → guardar el token: `1234567890:ABC-...`
3. Obtener el Chat ID del destino de notificaciones:
   - Abrir **@userinfobot** en Telegram para tu ID personal
   - Para grupos: añadir el bot al grupo, enviar un mensaje, buscar con **@RawDataBot**
4. El script `setup.sh` registra el webhook automáticamente

> **CRÍTICO post-instalación:** el destinatario de notificaciones debe **buscar el bot y enviar `/start`** al menos una vez. Telegram bloquea mensajes de bots que el usuario no ha iniciado primero (error 403 Forbidden). Sin este paso las alertas de escalado fallan silenciosamente.

### 3.5 Calendly — agendamiento de leads (OBLIGATORIO)

Calendly notifica a este sistema cuando un lead agenda o cancela una cita. Sin esta integración el sistema no puede avanzar un lead a la etapa "agendado" (D) automáticamente.

**Requiere plan de pago:** Professional, Teams o Enterprise de Calendly. El plan gratuito no permite registrar webhooks vía API.

**Pasos para obtener las credenciales:**

**A) Personal Access Token:**
1. Iniciar sesión en Calendly
2. Ir a: **Integrations & Apps** → **API & Webhooks**
3. Click en **Generate New Token** → guardar el token (empieza con `eyJ...`)

**B) Organization URI:**
Ejecutar este comando con el token anterior:
```bash
curl https://api.calendly.com/users/me \
  -H "Authorization: Bearer <TU_PERSONAL_TOKEN>"
```
De la respuesta JSON, copiar el valor del campo `"organization"`:
```json
{
  "resource": {
    "uri": "https://api.calendly.com/users/ABC123",
    "organization": "https://api.calendly.com/organizations/XYZ789"
  }
}
```
El valor del campo `organization` es el `CALENDLY_ORG_URI`.

El script `setup.sh` registra el webhook de Calendly automáticamente al final de la instalación.

**Cómo funciona la integración:**
- Calendly envía `invitee.created` → `/webhook/calendly` → el lead avanza a etapa D
- La URL de Calendly de cada tenant lleva `?utm_content={subscriber_id}` inyectado automáticamente (así el sistema identifica al lead sin pedirle email)

### 3.6 LangSmith — observabilidad técnica del agente (OPCIONAL)

LangSmith muestra la traza interna del grafo LangGraph: cada nodo, el call al LLM, tokens y latencia. Es útil para debug técnico avanzado.

> **Nota:** La observabilidad de negocio (qué dijo el agente, qué flows activó, métricas por conversación) siempre se guarda en Postgres (`api.agent_turn_traces`) y funciona independientemente de LangSmith.

1. Crear cuenta en [smith.langchain.com](https://smith.langchain.com) — elegir región **EU** o **US**
2. Ir a **Settings** → **API Keys** → **Create API Key**
3. Guardar la key: `lsv2_pt_...`

El `setup.sh` pregunta por estas credenciales y permite omitirlas con Enter.

---

## 4. Configuración de DNS

### Estructura recomendada: 1 registro A + CNAMEs

La forma más eficiente es crear **un solo registro A** apuntando al servidor, y el resto como **CNAME** apuntando a ese nombre. Si el servidor cambia de IP, basta con actualizar un solo registro.

```
# 1 registro A — IP del servidor
server.tudominio.com    A       1.2.3.4

# 5 registros CNAME — apuntan al A
panel.tudominio.com     CNAME   server.tudominio.com
api.tudominio.com       CNAME   server.tudominio.com
dashboard.tudominio.com CNAME   server.tudominio.com
minio.tudominio.com     CNAME   server.tudominio.com
minio-console.tudominio.com  CNAME   server.tudominio.com
```

| Registro | Tipo | Valor | Propósito |
|----------|------|-------|-----------|
| `server` | A | `1.2.3.4` | IP del servidor (único punto a cambiar si migras) |
| `panel` | CNAME | `server.tudominio.com` | Panel n8n + UI de workflows |
| `api` | CNAME | `server.tudominio.com` | API DM Setter (recibe webhooks de ManyChat y Calendly) |
| `dashboard` | CNAME | `server.tudominio.com` | Panel de métricas y prospectos |
| `minio` | CNAME | `server.tudominio.com` | MinIO S3 (almacenamiento de activos) |
| `minio-console` | CNAME | `server.tudominio.com` | Consola web de MinIO |

**TTL recomendado:** 300 segundos (5 min) durante instalación. Subir a 3600 después.

**Verificar propagación antes de instalar:**
```bash
dig +short panel.tudominio.com
# Debe devolver la IP 1.2.3.4 (puede tardar hasta el TTL en propagarse)
```

> Los certificados SSL (Let's Encrypt) se generan vía HTTP-01 challenge por Traefik. Si el DNS no está propagado cuando arranca Traefik, los certificados fallan y los servicios no arrancan. Verificar DNS antes de ejecutar `setup.sh`.

---

## 5. Instalación inicial

```bash
# 1. Clonar el repositorio en el servidor
git clone https://github.com/revolicord/n8n-production-stack.git
cd n8n-production-stack

# 2. Ejecutar el script de instalación interactivo
bash scripts/setup.sh
```

> Para probar una rama de feature en vez de `master` (ej. en un servidor nuevo de pruebas), agregá `-b <rama>` al clone:
> ```bash
> git clone -b feat/agent-fase1-contratos https://github.com/revolicord/n8n-production-stack.git
> cd n8n-production-stack
> ```

### Qué pide el script (en orden)

| Paso | Variable | Obligatorio |
|------|----------|-------------|
| Subdominios | `N8N_HOST`, `API_HOST`, `DASHBOARD_HOST`, etc. | Sí |
| Email SSL | `ACME_EMAIL` | Sí (solo primer install) |
| GitHub PAT | `GITHUB_TOKEN`, owner, repo, branch | Sí |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID` | **Sí** |
| Calendly | `CALENDLY_PERSONAL_TOKEN`, `CALENDLY_ORG_URI` | **Sí** |
| Anthropic | `ANTHROPIC_API_KEY` | **Sí** |
| LangSmith | `LANGSMITH_API_KEY` | No (Enter para omitir) |

Las contraseñas internas (PostgreSQL, Redis, MinIO, tokens JWT, etc.) se **generan automáticamente** con `openssl rand`.

### Qué hace el script automáticamente

1. Verifica Docker (lo instala si falta)
2. Inicializa Docker Swarm
3. Crea la red overlay `traefik-public`
4. Instala Traefik v2.11 con Let's Encrypt
5. Construye las imágenes Docker locales (`dm-api:local`, `dm-dashboard:local`)
6. Despliega el stack completo con todas las variables
7. Inicializa los buckets de MinIO
8. **Registra el webhook de Telegram** (`bash scripts/telegram-set-webhook.sh`)
9. **Registra el webhook de Calendly** (`bash scripts/calendly-set-webhook.sh`)

**Duración total:** 5–10 minutos en primer despliegue.

### Verificar que todo está corriendo

```bash
make status
# Todos los servicios deben mostrar Replicas: 1/1 (o N/N)

curl -sf https://api.TU_DOMINIO.com/healthz && echo "OK"
curl -sf https://panel.TU_DOMINIO.com/healthz && echo "OK"
```

> Si algún servicio no arranca: `docker stack ps n8n --no-trunc` muestra el error exacto.

---

## 6. Configuración post-instalación

### 6.1 n8n — workflows del agente

Acceder al panel de n8n: `https://panel.TU_DOMINIO.com`

En el primer acceso, n8n pide crear un usuario administrador. Guardar esas credenciales.

#### Workflow `agent-run` (obligatorio)

Este workflow recibe cada turno del agente y ejecuta el LLM.

1. En n8n → **New Workflow**
2. Consultar la especificación completa en `docs/n8n/README.md` y `docs/09_AGENT_TOOLS_AND_INTEGRATIONS.md`
3. El webhook trigger debe responder en: `https://panel.TU_DOMINIO.com/webhook/agent-run`
4. Credenciales a configurar en n8n:
   - **PostgreSQL:** para el Chat Memory (tabla `n8n_chat_histories`, misma DB que la app)
   - **HTTP Request (callback):** Bearer token = `N8N_CALLBACK_TOKEN` del `.env`
   - **Anthropic:** `ANTHROPIC_API_KEY`

Consultar el código exacto de los Code nodes en `docs/n8n/nodes/`.

#### Workflow `followup-runner` (recomendado)

Cron que corre cada `FOLLOWUP_INTERVAL_MINUTES` minutos para avanzar secuencias de followup.

1. Trigger: Schedule (cada 5 minutos)
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
     - `X-MC-Token: <MC_WEBHOOK_TOKEN del .env>`
4. **Body:** incluir los campos del subscriber que el agente necesita:
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
   Ver especificación exacta en `docs/06_DM_API_MANYCHAT_PAYLOAD.md` (ADR-0006).

#### Convención de nombres de flows (ADR-0016)

Todos los flows que el agente puede activar deben seguir el patrón:

```
QC_{ETAPA}_{MEDIO}_{DESCRIPCION}_{VARIANTE}
```

Ejemplos:
- `QC_AWARENESS_VIDEO_VSL_A` — video VSL para lead en awareness, variante A
- `QC_CONSIDERATION_TEXT_OBJECION_PRECIO` — texto para objeción de precio
- `QC_DECISION_FLOW_CERRAR_DEMO` — flow de cierre de demo en etapa decision

Después de crear los flows en ManyChat, sincronizar con la DB:
```bash
curl -X POST https://api.TU_DOMINIO.com/tenants/{slug}/tools/sync \
  -H "Authorization: Bearer <ADMIN_JWT_SECRET>"
# O desde el panel /settings → pestaña Flows
```

#### URL de Calendly con UTM (crítico)

La URL de Calendly que el agente envía a los leads **debe llevar** `?utm_content={subscriber_id}`. El campo `utm_content` es la única forma que tiene el sistema de identificar al lead cuando Calendly hace el callback.

El sistema inyecta el UTM automáticamente si la `calendly_url` del tenant está configurada sin parámetros. Configurar desde el panel `/settings` del tenant.

### 6.3 MinIO — activos de followups

MinIO almacena imágenes y videos usados en followups tipo `content` (ADR-0018).

**Acceder a la consola:** `https://minio-console.TU_DOMINIO.com`
- Usuario: `MINIO_ROOT_USER` del `.env` (default: `minio_admin`)
- Contraseña: `MINIO_ROOT_PASSWORD` del `.env`

**Buckets creados automáticamente por el script:**
- `n8n-data` — almacenamiento binario de n8n (privado)
- `assets` — activos de followups (lectura pública)

**Subir activos para followups:**
1. Consola MinIO → bucket `assets`
2. Crear carpeta por tenant: `/{slug}/`
3. Subir imágenes/videos
4. URL pública: `https://minio.TU_DOMINIO.com/assets/{slug}/archivo.jpg`
5. Usar esa URL en el campo `media_url` del template de followup

### 6.4 Telegram — escalado a humano

El webhook de Telegram se registra automáticamente durante `setup.sh`. Solo queda el paso manual:

> **PASO MANUAL OBLIGATORIO:** El destinatario de las notificaciones de escalado debe **buscar el bot en Telegram por su username y enviar `/start`**. Sin este paso Telegram rechaza los mensajes del bot con error 403 Forbidden, y las alertas no llegan.

**Si el webhook falló durante el setup:**
```bash
bash scripts/telegram-set-webhook.sh
```

**Verificar que funciona:**
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
# Debe mostrar la URL registrada y pending_update_count
```

**Configurar chat de escalado por tenant** (override del chat_id global):
Panel `/settings` → **Configuración** → campo `telegram_chat_id`.

### 6.5 Calendly — agendamiento de leads

El webhook de Calendly se registra automáticamente durante `setup.sh`. Si falló, ejecutar manualmente:

```bash
bash scripts/calendly-set-webhook.sh
```

**Verificar la suscripción activa:**
```bash
source .env
curl "https://api.calendly.com/webhook_subscriptions?organization=${CALENDLY_ORG_URI}&scope=organization" \
  -H "Authorization: Bearer ${CALENDLY_PERSONAL_TOKEN}"
```

**Cómo funciona el flujo completo:**
1. Lead agenda en Calendly → Calendly llama `POST /webhook/calendly`
2. El sistema identifica al lead por `utm_content` en la URL de Calendly
3. Persiste el booking en la tabla `bookings`
4. Cancela followups de prospección activos (para que no siga recibiendo "¿ya agendaste?")
5. Inyecta un `ChangeStage(→D, cascade)` que el agente ejecuta
6. El agente confirma la cita con texto personalizado y activa la cascada `C→D`

**Si el lead cancela la cita:** Calendly envía `invitee.canceled`, el sistema marca el booking como cancelado y los recordatorios de cita se detienen.

### 6.6 LangSmith — observabilidad técnica del agente (opcional)

Si configuraste LangSmith durante el setup, las trazas del agente se envían automáticamente sin configuración adicional en el código.

**Verificar que las trazas llegan:**
1. Enviar un DM de prueba desde Instagram
2. Ir a [eu.smith.langchain.com](https://eu.smith.langchain.com) → proyecto `dm-agent`
3. Debe aparecer un run nuevo con los nodos del grafo

**Qué se ve en cada run:**
- Árbol de nodos: `assemble_context` → `prepare_prompt` → `understand` → `flow_engine` → `execute_actions` → `respond`
- El call a Anthropic: input (prompt + mensajes), output (plan del LLM), tokens, latencia
- Errores con stack trace si algún nodo falla
- Metadata: `thread_id = conversation_id` para filtrar por conversación

**Gotcha importante:**
LangSmith ≥ 0.2 **solo** lee variables `LANGSMITH_*`. Las variables antiguas `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY` se ignoran silenciosamente. Si no llegan trazas, verificar los nombres exactos de las variables en `.env`.

**Activar después de instalar** (si se omitió en el setup):
```bash
# Añadir al .env:
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=dm-agent
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com  # o https://api.smith.langchain.com para US

# Reiniciar api-worker para que tome las vars:
docker service update --force n8n_api-worker
```

---

## 7. Onboarding de un tenant nuevo

Un "tenant" es un cliente de la agencia que usa el setter en Instagram.

### 7.1 Crear el tenant en la DB

```bash
make seed-tenant SLUG=nombre-cliente N8N_WORKFLOW_URL=https://panel.TU_DOMINIO.com/webhook/agent-run
# SLUG: identificador único, solo minúsculas y guiones (ej: quantum-creators)
# NAME es opcional: make seed-tenant SLUG=qc NAME="Quantum Creators" N8N_WORKFLOW_URL=...
```

### 7.2 Importar flows y persona del agente

```bash
make seed-agent-config SLUG=nombre-cliente
# Lee configuración de packages/db/seeds/tenant-configs/{slug}/
# Importa: funnel_stages, stage_flows, followup_templates, persona del agente
```

Para un tenant nuevo, crear primero los archivos de seed:
```
packages/db/seeds/tenant-configs/nombre-cliente/
├── flows.json        # flows QC_* del tenant (convención ADR-0016)
├── persona.json      # system prompt, tono, estilo del agente
└── stages.json       # etapas del funnel y configuración
```

Ver `packages/db/seeds/tenant-configs/` para ejemplos del formato.

### 7.3 Configurar desde el dashboard

Acceder a `https://dashboard.TU_DOMINIO.com`
- Contraseña: `PANEL_PASSWORD` del `.env`
- Ir a `/settings` para configurar flows, stages, persona, followups y URL de Calendly por tenant

### 7.4 Test end-to-end

```bash
# Smoke test completo (texto, flows, followups, Telegram)
pnpm smoke:manychat

# O manualmente:
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

La tabla `api.agent_turn_traces` guarda la traza legible de cada turno del agente. Funciona siempre, no depende de LangSmith, y nunca sale PII de la infraestructura.

```sql
-- Últimos turnos de un tenant
SELECT
  t.id,
  t.mode,
  t.status,
  t.input->>'messages'  AS user_message,
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

-- Conversaciones activas
SELECT
  s.ig_username,
  c.status,
  c.last_user_msg_at,
  ls.stage_id AS etapa_actual
FROM api.conversations c
JOIN api.subscribers s ON s.id = c.subscriber_id
LEFT JOIN api.lead_stages ls ON ls.subscriber_id = s.id
WHERE c.tenant_id = '<uuid>'
  AND c.status = 'open'
ORDER BY c.last_user_msg_at DESC;

-- Métricas de tokens últimas 24h
SELECT
  COUNT(*) AS turns,
  SUM((t.metrics->>'input_tokens')::int) AS tokens_in,
  SUM((t.metrics->>'output_tokens')::int) AS tokens_out,
  AVG((t.metrics->>'total_ms')::int) AS avg_ms
FROM api.agent_turn_traces t
WHERE t.tenant_id = '<uuid>'
  AND t.created_at > NOW() - INTERVAL '24 hours';

-- Bookings activos (leads que agendaron)
SELECT
  s.ig_username,
  b.start_time,
  b.timezone,
  b.invitee_email,
  b.join_url
FROM api.bookings b
JOIN api.subscribers s ON s.id = b.subscriber_id
WHERE b.tenant_id = '<uuid>'
  AND b.start_time > NOW()
ORDER BY b.start_time;
```

**Desde el dashboard:** `https://dashboard.TU_DOMINIO.com` muestra estas métricas en interfaz visual.

### 8.2 Observabilidad técnica — LangSmith (opcional)

Ver sección [6.6](#66-langsmith--observabilidad-técnica-del-agente-opcional). Complementa `agent_turn_traces` con la vista interna del grafo LangGraph.

### 8.3 Logs de servicios en tiempo real

```bash
make logs-api          # Fastify — peticiones entrantes, errores de webhook
make logs-api-worker   # BullMQ — procesamiento de debounce, dispatch a n8n, LangGraph
make logs-main         # n8n main — workflows, credenciales, scheduler
make logs-webhook      # n8n webhook — recepción de llamadas desde la API
make logs-worker       # n8n workers — ejecución de workflow jobs
make logs-dashboard    # Next.js dashboard
make logs-minio        # MinIO — accesos S3

# Buscar errores en api-worker (el servicio más crítico):
docker service logs n8n_api-worker 2>&1 | grep -i error | tail -50
```

### 8.4 Salud de los servicios

```bash
make status
# Todos los servicios deben mostrar REPLICAS N/N

# Healthchecks individuales:
curl -sf https://api.TU_DOMINIO.com/healthz && echo "API OK"
curl -sf https://panel.TU_DOMINIO.com/healthz && echo "n8n OK"
```

### 8.5 Colas BullMQ y Redis

```bash
# Conectar a Redis
docker exec -it $(docker ps -qf name=n8n_redis) redis-cli -a <REDIS_PASSWORD>

# Ver colas BullMQ activas
KEYS bullmq:*
LLEN bullmq:dm-turns:wait

# Ver debounce buffers activos
KEYS *:debounce:*
```

### 8.6 Limpieza de trazas antiguas

```bash
# Borrar trazas de más de 30 días
make prune-traces DAYS=30

# Ver espacio ocupado por trazas
docker exec -it $(docker ps -qf name=n8n_postgres) \
  psql -U n8n -c "
    SELECT pg_size_pretty(pg_total_relation_size('api.agent_turn_traces'));
  "
```

---

## 9. Operaciones día a día

### Verificar estado general

```bash
make status
```

### Ver logs críticos

```bash
make logs-api-worker   # procesamiento de mensajes
make logs-api          # errores de webhook entrante
```

### Acceso directo a la DB

```bash
docker exec -it $(docker ps -qf name=n8n_postgres) psql -U n8n -d n8n
# \dt api.*    lista todas las tablas propias
```

### Acceso a Redis

```bash
docker exec -it $(docker ps -qf name=n8n_redis) redis-cli -a <REDIS_PASSWORD>
```

### Exportar conversación para análisis o tuning

```bash
make export-conversation CONV=<conversation_uuid>
# Genera bundle en ./agent-tuning-out/
```

---

## 10. Escalado

### Escalar workers n8n

```bash
make scale-workers N=5   # a 5 réplicas
make scale-workers N=3   # volver a 3 (default)
```

### Escalar la API

```bash
make scale-api N=2   # 2 réplicas de api + api-worker
```

### Parámetros de capacidad

| Variable | Default | Efecto |
|----------|---------|--------|
| `WORKER_CONCURRENCY` | 10 | Jobs BullMQ paralelos por worker |
| `N8N_CONCURRENCY_PRODUCTION_LIMIT` | 10 | Workflows paralelos por réplica n8n-worker |
| `RATE_PER_MINUTE` | 20 | Rate limit de webhooks por subscriber |
| `DEBOUNCE_MS` | 15000 | Ventana de debounce (ms) |

---

## 11. Backups y recuperación

### Backup manual

```bash
make backup
# pg_dump PostgreSQL + mirror MinIO → /var/backups/n8n/
# Retiene 7 días automáticamente
```

### Backup automático (cron)

```bash
crontab -e
# Backup diario a las 2am:
0 2 * * * cd /root/n8n-production-stack && bash scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

### Restaurar PostgreSQL

```bash
ls -lt /var/backups/n8n/postgres/

gunzip < /var/backups/n8n/postgres/n8n_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i $(docker ps -qf name=n8n_postgres) psql -U n8n -d n8n
```

### `N8N_ENCRYPTION_KEY` — secreto crítico

Esta clave cifra todas las credenciales de n8n. **Si se pierde o cambia, todas las integraciones de n8n quedan inutilizables** (hay que reintroducirlas manualmente).

- Guardar en gestor de secretos (1Password, Vault) desde el primer día
- Nunca rotar en producción sin plan de migración

---

## 12. Actualización de la plataforma

### Actualizar n8n

```bash
make update   # rolling update sin downtime
```

### Actualizar código propio (API / Dashboard / Agente)

```bash
# El flujo normal es via /ship:
# /ship "descripción del cambio"

# O manualmente:
git pull origin master
make rebuild-api        # reconstruye dm-api:local y actualiza api + api-worker
make rebuild-dashboard  # reconstruye dm-dashboard:local y actualiza dashboard
```

### Aplicar migraciones de DB

```bash
make migrate
# Siempre después de git pull que incluya cambios en packages/db/drizzle/
```

---

## 13. Resolución de problemas

### El servicio no arranca

```bash
docker stack ps n8n --no-trunc
# Muestra el error exacto de cada task fallida
```

### Certificados SSL no se generan

```bash
# 1. Verificar DNS:
dig +short panel.TU_DOMINIO.com
# 2. Verificar puerto 80 accesible desde internet:
curl -v http://panel.TU_DOMINIO.com
# 3. Forzar reintento de Traefik:
docker service update --force traefik
# 4. Ver logs de Traefik:
docker service logs traefik
```

### Webhooks de ManyChat no llegan

```bash
# Verificar API:
curl https://api.TU_DOMINIO.com/healthz
# Ver logs durante envío de prueba:
make logs-api
# Verificar token: MC_WEBHOOK_TOKEN en .env debe coincidir con header X-MC-Token en ManyChat
```

### Calendly no avanza la etapa del lead

```bash
# 1. Verificar que el webhook está registrado:
bash scripts/calendly-set-webhook.sh   # idempotente: no duplica
# 2. Verificar que la URL de Calendly del tenant lleva utm_content:
#    https://calendly.com/usuario/evento?utm_content={subscriber_id}
# 3. Ver logs durante una cita de prueba:
make logs-api
# 4. Verificar en DB que el booking llegó:
docker exec -it $(docker ps -qf name=n8n_postgres) \
  psql -U n8n -c "SELECT * FROM api.bookings ORDER BY created_at DESC LIMIT 5;"
```

### Notificaciones de Telegram no llegan

```bash
# 1. Verificar webhook registrado:
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
# 2. El destinatario debe haber enviado /start al bot (error 403 si no lo hizo)
# 3. Ver logs:
make logs-api-worker | grep -i telegram
# 4. Re-registrar webhook si es necesario:
bash scripts/telegram-set-webhook.sh
```

### El agente no responde

```bash
# 1. Verificar que el workflow agent-run está ACTIVO en panel.TU_DOMINIO.com
# 2. Ver logs del worker BullMQ:
make logs-api-worker
# 3. Verificar URL interna de n8n:
#    N8N_BASE_URL en .env debe ser http://n8n-webhook:5678 (nombre de servicio interno)
```

### Trazas de LangSmith no llegan

```bash
# Variables exactas en .env (NO usar LANGCHAIN_*):
grep LANGSMITH .env
# Si cambiaste el .env, reiniciar api-worker:
docker service update --force n8n_api-worker
```

### DB grande / queries lentas

```bash
# Ver tamaño de tablas:
docker exec -it $(docker ps -qf name=n8n_postgres) \
  psql -U n8n -c "
    SELECT tablename,
           pg_size_pretty(pg_total_relation_size('api.'||tablename)) AS size
    FROM pg_tables
    WHERE schemaname = 'api'
    ORDER BY pg_total_relation_size('api.'||tablename) DESC;
  "
# Limpiar trazas antiguas:
make prune-traces DAYS=30
```

---

## 14. Referencia de variables de entorno

### Dominios

| Variable | Ejemplo | Obligatorio |
|----------|---------|-------------|
| `N8N_HOST` | `panel.tudominio.com` | Sí |
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
| `MC_WEBHOOK_TOKEN` | Header `X-MC-Token` que ManyChat envía | Sí |
| `N8N_CALLBACK_TOKEN` | Bearer token de callbacks desde n8n | Sí |
| `ADMIN_JWT_SECRET` | Clave JWT del panel de administración | Sí |
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
| `ANTHROPIC_API_KEY` | `sk-ant-...` | **Sí** |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | No |
| `AGENT_TIMEOUT_MS` | `60000` | No |

### Telegram — escalado a humano

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather | **Sí** |
| `TELEGRAM_DEFAULT_CHAT_ID` | Chat/grupo destino de notificaciones | **Sí** |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto para verificar callbacks de botones | **Sí** |
| `PAUSE_REMINDER_HOURS` | Horas entre recordatorios de leads pausados (0=off) | No (default: 6) |
| `FOLLOWUP_INTERVAL_MINUTES` | Frecuencia del runner de followups (0=off) | No (default: 5) |

### Calendly — agendamiento

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `CALENDLY_PERSONAL_TOKEN` | Personal Access Token de Calendly | **Sí** |
| `CALENDLY_ORG_URI` | `https://api.calendly.com/organizations/...` | **Sí** |

### LangSmith — observabilidad técnica (opcional)

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `LANGSMITH_TRACING` | `true` para activar | No |
| `LANGSMITH_API_KEY` | `lsv2_pt_...` | No |
| `LANGSMITH_PROJECT` | `dm-agent` | No |
| `LANGSMITH_ENDPOINT` | EU: `https://eu.api.smith.langchain.com` | No |

---

## 15. Referencia de secretos

| Secreto | Generación | Rotable | Impacto de rotar |
|---------|-----------|---------|-----------------|
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32` | **NUNCA** | Rompe todas las credenciales n8n |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` | Sí | Actualizar `.env` + redesplegar |
| `REDIS_PASSWORD` | `openssl rand -base64 32` | Sí | Actualizar `.env` + redesplegar |
| `MINIO_ROOT_PASSWORD` | `openssl rand -base64 32` | Sí | Actualizar `.env` + `MINIO_SECRET_KEY` + redesplegar |
| `MC_WEBHOOK_TOKEN` | `openssl rand -hex 32` | Sí | Actualizar header en ManyChat inmediatamente |
| `N8N_CALLBACK_TOKEN` | `openssl rand -hex 32` | Sí | Actualizar credencial en n8n workflow |
| `ADMIN_JWT_SECRET` | `openssl rand -hex 64` | Sí | Invalida todas las sesiones del dashboard |
| `PANEL_PASSWORD` | `openssl rand -base64 24` | Sí | Cambio inmediato, sin impacto en datos |
| `PANEL_JWT_SECRET` | `openssl rand -hex 64` | Sí | Invalida sesiones del dashboard |
| `GITHUB_TOKEN` | GitHub UI | Sí | Backup de workflows deja de funcionar |
| `ANTHROPIC_API_KEY` | Anthropic Console | Sí | Crear nueva antes de revocar la anterior |
| `TELEGRAM_BOT_TOKEN` | @BotFather `/token` | Sí | Re-registrar webhook después |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 16` | Sí | Re-ejecutar `telegram-set-webhook.sh` |
| `CALENDLY_PERSONAL_TOKEN` | Calendly UI | Sí | Re-ejecutar `calendly-set-webhook.sh` |
| `LANGSMITH_API_KEY` | LangSmith UI | Sí | Solo afecta observabilidad técnica |

---

## Checklist de instalación completa

### Antes de instalar
- [ ] Servidor Ubuntu 22.04 / Debian 12 con 4+ GB RAM
- [ ] Puertos 80 y 443 abiertos en el firewall del VPS
- [ ] Registro DNS `server.tudominio.com` tipo A apuntando a la IP del servidor
- [ ] 5 registros CNAME (`panel`, `api`, `dashboard`, `minio`, `minio-console`) apuntando a `server.tudominio.com`
- [ ] Propagación DNS verificada: `dig +short panel.tudominio.com` devuelve la IP correcta
- [ ] API key de Anthropic lista (`sk-ant-...`)
- [ ] GitHub PAT con permisos Contents: Read/Write listo
- [ ] Bot de Telegram creado en @BotFather, token y chat_id listos
- [ ] Cuenta Calendly de pago, Personal Access Token y Organization URI listos
- [ ] (Opcional) Cuenta LangSmith con API key

### Instalación
- [ ] `bash scripts/setup.sh` completado sin errores
- [ ] `make status` muestra todos los servicios en `1/1`
- [ ] `curl https://api.TU_DOMINIO.com/healthz` devuelve `{"status":"ok"}`
- [ ] `https://panel.TU_DOMINIO.com` accesible con certificado SSL válido
- [ ] `https://dashboard.TU_DOMINIO.com` accesible con la contraseña del `.env`
- [ ] Webhook de Telegram registrado (el script lo hace, verificar con `/getWebhookInfo`)
- [ ] Webhook de Calendly registrado (el script lo hace, verificar con la API de Calendly)

### Post-instalación
- [ ] Crear usuario administrador en n8n (primer acceso a `https://panel.TU_DOMINIO.com`)
- [ ] Crear workflow `agent-run` en n8n y verificar que el webhook responde
- [ ] `make seed-tenant SLUG=...` para el primer tenant
- [ ] `make seed-agent-config SLUG=...` para importar flows y persona
- [ ] Configurar External Request en ManyChat (URL + `X-MC-Token` header)
- [ ] Verificar URL de Calendly del tenant lleva `utm_content` automático
- [ ] Sincronizar flows: desde `/settings` o `POST /tenants/{slug}/tools/sync`
- [ ] **El destinatario de escalados envía `/start` al bot de Telegram**
- [ ] `make backup` y configurar cron de backup diario
- [ ] (LangSmith) Enviar DM de prueba y verificar que aparece run en LangSmith

### Validación final
- [ ] Lead de prueba en Instagram → agente responde
- [ ] Lead agenda en Calendly → sistema avanza a etapa D y el agente confirma
- [ ] Escalado manual → notificación llega a Telegram con botones
- [ ] Trazas en `api.agent_turn_traces` y visibles en dashboard
- [ ] Workflows de n8n se respaldan en GitHub al guardar cambios
