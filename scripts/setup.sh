#!/usr/bin/env bash
# ============================================================
# SETUP — Instalación completa n8n en producción (Docker Swarm)
# Uso: bash scripts/setup.sh
#
# Modos:
#   fresh:   instalación completa desde cero (genera nuevas credenciales)
#   agregar: sobre instalación existente — solo pide/genera vars faltantes
#            y aplica pasos de infraestructura idempotentes
#
# Requisitos previos:
#   - Ubuntu 22.04 / Debian 12
#   - Puertos 80 y 443 libres y abiertos en el firewall
#   - DNS de los subdominios apuntando a la IP del servidor
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${CYAN}══════════════════════════════════════${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}══════════════════════════════════════${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"

# ── 1. Detectar modo ─────────────────────────────────────────
MODE="fresh"
if [[ -f "$ENV_FILE" ]]; then
  warn ".env ya existe. ¿Qué deseas hacer?"
  echo ""
  echo "  [a] Agregar vars faltantes  (recomendado — conserva credenciales actuales)"
  echo "  [s] Sobreescribir todo      (instalación limpia — DESTRUYE credenciales)"
  echo "  [N] Cancelar"
  echo ""
  read -rp "  Opción [a/s/N]: " CONFIRM
  case "${CONFIRM,,}" in
    a)
      MODE="update"
      set -a
      # shellcheck disable=SC1090
      source "$ENV_FILE"
      set +a
      info "Modo actualización: se conservan todas las credenciales existentes."
      ;;
    s)
      MODE="fresh"
      warn "Modo fresh: se generarán nuevas credenciales. Las rutas n8n cifradas quedarán inaccesibles."
      read -rp "  ¿Confirmar sobreescritura? (escribe 'SI' para continuar): " DOUBLE_CONFIRM
      [[ "$DOUBLE_CONFIRM" == "SI" ]] || { info "Abortado."; exit 0; }
      ;;
    *)
      info "Abortado."
      exit 0
      ;;
  esac
fi

section "N8N PRODUCCIÓN — DOCKER SWARM + TRAEFIK"

# ── 0. Pantalla de requisitos previos ────────────────────────
echo ""
echo -e "${CYAN}  Antes de continuar, confirma que tienes listo lo siguiente:${NC}"
echo ""
echo -e "  ${YELLOW}SERVIDOR${NC}"
echo    "  ☐  Ubuntu 22.04 / Debian 12 (recomendado)"
echo    "  ☐  Puertos 80 y 443 abiertos en el firewall del VPS/servidor"
echo    "  ☐  Docker instalado  (o el script lo instalará con get.docker.com)"
echo ""
echo -e "  ${YELLOW}DNS — 5 subdominios apuntando a la IP de este servidor:${NC}"
echo    "  ☐  n8n.tudominio.com             → Panel n8n + UI de workflows"
echo    "  ☐  minio.tudominio.com           → Almacenamiento S3 (activos, imágenes)"
echo    "  ☐  minio-console.tudominio.com   → Consola web de MinIO"
echo    "  ☐  api.tudominio.com             → API DM Setter (webhook ManyChat)"
echo    "  ☐  dashboard.tudominio.com       → Panel de métricas y prospectos"
echo    "  ↳  Los certificados SSL se generan automáticamente (Let's Encrypt)."
echo    "     Sin DNS correcto, los certificados fallan y los servicios no arrancan."
echo ""
echo -e "  ${YELLOW}MANYCHAT${NC}"
echo    "  ☐  Cuenta ManyChat con Instagram conectada"
echo    "  ☐  Flujo con acción 'External Request' listo para configurar"
echo    "     (la URL y el token de autenticación se generan durante esta instalación)"
echo ""
echo -e "  ${YELLOW}GITHUB (backup de workflows n8n)${NC}"
echo    "  ☐  Repositorio GitHub donde guardar los backups de workflows"
echo    "  ☐  Personal Access Token (PAT) con permiso  Contents: Read & Write"
echo    "     Crear en: GitHub → Settings → Developer settings → Fine-grained tokens"
echo ""
echo -e "  ${YELLOW}TELEGRAM (obligatorio — escalado a humano)${NC}"
echo    "  ☐  Bot creado en @BotFather → /newbot  (guarda el token que te da)"
echo    "  ☐  Chat ID del destino de notificaciones"
echo    "     (usa @userinfobot o @RawDataBot para obtener tu chat_id)"
echo -e "  ${RED}  ☐  CRÍTICO: después de instalar, el agente DEBE abrir el bot en Telegram${NC}"
echo -e "  ${RED}     y enviar /start una sola vez. Sin este paso Telegram rechaza los${NC}"
echo -e "  ${RED}     mensajes del bot con error 403 y las notificaciones no llegan.${NC}"
echo ""
echo -e "  ${YELLOW}CALENDLY (obligatorio — requiere plan de pago)${NC}"
echo    "  ☐  Plan Calendly de pago: Professional, Teams o Enterprise"
echo    "     (el plan gratuito no permite registrar webhooks vía API)"
echo    "  ☐  Personal Access Token: calendly.com/integrations/api_webhooks → Generate Token"
echo    "  ☐  Organization URI: obtenido con"
echo    "       curl https://api.calendly.com/users/me -H 'Authorization: Bearer <token>'"
echo    "     (campo 'organization' en la respuesta)"
echo -e "  ${YELLOW}  ↳  El webhook se registra automáticamente al final de esta instalación.${NC}"
echo ""
echo -e "  ${YELLOW}ANTHROPIC (obligatorio — motor del agente IA)${NC}"
echo    "  ☐  API Key de Anthropic: console.anthropic.com → API Keys"
echo    "     Formato: sk-ant-..."
echo ""
echo -e "  ${YELLOW}EMAIL${NC}"
echo    "  ☐  Dirección de email válida para registrar los certificados SSL"
echo    "     (Let's Encrypt la usa solo para avisos de expiración, no spam)"
echo ""
echo -e "${CYAN}══════════════════════════════════════${NC}"
read -rp "  ¿Tienes todo listo? Presiona Enter para continuar o Ctrl+C para cancelar: " _PREREQ_CONFIRM
echo ""

# ── Helpers ──────────────────────────────────────────────────

# Pide valor solo si la variable no está ya definida.
ask_if_missing() {
  local var="$1" prompt="$2" default="${3:-}" required="${4:-yes}"
  local current="${!var:-}"
  if [[ -n "$current" ]]; then
    info "  ${var}: ya configurado"
  else
    if [[ -n "$default" ]]; then
      read -rp "  ${prompt} [${default}]: " value
      value="${value:-$default}"
    else
      read -rp "  ${prompt}: " value
    fi
    if [[ -z "$value" && "$required" == "yes" ]]; then
      error "${var} es obligatorio."
    fi
    printf -v "$var" '%s' "$value"
  fi
}

# Genera secreto solo si la variable no está ya definida.
gen_if_missing() {
  local var="$1" cmd="$2"
  local current="${!var:-}"
  if [[ -z "$current" ]]; then
    value=$(eval "$cmd")
    printf -v "$var" '%s' "$value"
    info "  ${var}: generado"
  else
    info "  ${var}: ya existe"
  fi
}

# ── 2. Email SSL (solo si Traefik no está instalado) ─────────
ACME_EMAIL="${ACME_EMAIL:-}"
if ! docker service ls --format '{{.Name}}' 2>/dev/null | grep -q '^traefik$'; then
  echo ""
  info "Traefik no está instalado — se necesita email para Let's Encrypt (SSL):"
  ask_if_missing ACME_EMAIL "Email para certificados SSL" "" "yes"
fi

# ── 3. Subdominios ───────────────────────────────────────────
echo ""
info "Subdominios (sin https://):"
echo ""
ask_if_missing N8N_HOST             "Panel n8n        (ej: n8n.tudominio.com)" "" "yes"
ask_if_missing MINIO_DOMAIN         "MinIO S3         (ej: minio.tudominio.com)" "" "yes"
ask_if_missing MINIO_CONSOLE_DOMAIN "MinIO Consola    (ej: minio-console.tudominio.com)" "" "yes"
ask_if_missing API_HOST             "API DM Setter    (ej: api.tudominio.com)" "" "yes"
ask_if_missing DASHBOARD_HOST       "Dashboard        (ej: dashboard.tudominio.com)" "" "yes"

TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-traefik-public}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minio_admin}"

# ── 4. Credenciales (genera solo las faltantes) ──────────────
section "Verificando credenciales..."
gen_if_missing POSTGRES_PASSWORD   "openssl rand -base64 32 | tr -d '/+=\n' | head -c 32"
gen_if_missing REDIS_PASSWORD      "openssl rand -base64 32 | tr -d '/+=\n' | head -c 32"
gen_if_missing N8N_ENCRYPTION_KEY  "openssl rand -hex 32"
gen_if_missing MINIO_ROOT_PASSWORD "openssl rand -base64 32 | tr -d '/+=\n' | head -c 32"
gen_if_missing MC_WEBHOOK_TOKEN    "openssl rand -hex 32"
gen_if_missing N8N_CALLBACK_TOKEN  "openssl rand -hex 32"
gen_if_missing ADMIN_JWT_SECRET    "openssl rand -hex 64"
gen_if_missing PANEL_PASSWORD      "openssl rand -base64 24 | tr -d '/+=\n' | head -c 24"
gen_if_missing PANEL_JWT_SECRET    "openssl rand -hex 64"

# ── 5. GitHub backup de workflows ────────────────────────────
section "Configuración de backup de workflows a GitHub..."
echo ""
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  info "Necesitas un Personal Access Token (PAT) de GitHub con permisos Contents: Read/Write"
  info "Crear en: GitHub → Settings → Developer settings → Fine-grained tokens"
  echo ""
  read -rp "  GitHub PAT token: " GITHUB_TOKEN
  [[ -z "$GITHUB_TOKEN" ]] && error "GitHub token es obligatorio para el backup de workflows."
else
  info "  GITHUB_TOKEN: ya configurado"
fi
ask_if_missing GITHUB_OWNER  "GitHub owner/org" "revolicord" "yes"
ask_if_missing GITHUB_REPO   "GitHub repo" "n8n-production-stack" "yes"
ask_if_missing GITHUB_BRANCH "Branch" "master" "yes"
ask_if_missing GITHUB_PATH   "Carpeta de workflows" "n8n-workflows" "yes"

# ── 6. Escalado a humano — Telegram (OBLIGATORIO) ────────────
section "Escalado a humano vía Telegram (obligatorio)..."
echo ""
ask_if_missing TELEGRAM_BOT_TOKEN        "Bot token de @BotFather" "" "yes"
ask_if_missing TELEGRAM_DEFAULT_CHAT_ID  "Chat/grupo ID destino (de @userinfobot)" "" "yes"
gen_if_missing TELEGRAM_WEBHOOK_SECRET   "openssl rand -hex 16"
PAUSE_REMINDER_HOURS="${PAUSE_REMINDER_HOURS:-6}"
echo ""
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
warn "  PASO MANUAL OBLIGATORIO tras la instalación:"
warn "  El agente (o cualquier destinatario de TELEGRAM_DEFAULT_CHAT_ID)"
warn "  debe abrir el bot en Telegram y enviar /start al menos una vez."
warn "  Telegram prohíbe que los bots inicien conversaciones con usuarios"
warn "  que no les han escrito primero. Sin este paso, las notificaciones"
warn "  de escalado fallan silenciosamente con error 403 Forbidden."
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 6b. Calendly (OBLIGATORIO — requiere plan de pago) ────────
section "Calendly — webhook de agendamiento (obligatorio)..."
echo ""
info "Requiere plan Calendly de pago (Professional, Teams o Enterprise)."
info "Obtener Personal Access Token en:"
info "  calendly.com/integrations/api_webhooks → API & Webhooks → Generate Token"
info ""
info "Obtener Organization URI ejecutando (con el token anterior):"
info "  curl https://api.calendly.com/users/me -H 'Authorization: Bearer <token>'"
info "  → copiar el valor del campo 'organization'"
echo ""
ask_if_missing CALENDLY_PERSONAL_TOKEN "Calendly Personal Access Token" "" "yes"
ask_if_missing CALENDLY_ORG_URI        "Calendly Organization URI (https://api.calendly.com/organizations/...)" "" "yes"

# ── 6c. API Key de Anthropic (OBLIGATORIO) ────────────────────
section "Anthropic — motor del agente IA (obligatorio)..."
echo ""
info "Obtener en: console.anthropic.com → API Keys"
ask_if_missing ANTHROPIC_API_KEY "Anthropic API Key (sk-ant-...)" "" "yes"
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-6}"
AGENT_TIMEOUT_MS="${AGENT_TIMEOUT_MS:-60000}"

# ── 6d. LangSmith (opcional — observabilidad técnica del agente)
section "LangSmith — observabilidad técnica (opcional)..."
echo ""
info "La observabilidad de negocio (agent_turn_traces) funciona siempre."
info "LangSmith es adicional para ver la traza interna del grafo LangGraph."
info "Dejar vacío para omitir. Se puede activar después editando .env"
echo ""
if [[ -z "${LANGSMITH_API_KEY:-}" ]]; then
  read -rp "  LangSmith API Key (lsv2_pt_...) [Enter para omitir]: " LANGSMITH_API_KEY
  LANGSMITH_API_KEY="${LANGSMITH_API_KEY:-}"
else
  info "  LANGSMITH_API_KEY: ya configurado"
fi
if [[ -n "${LANGSMITH_API_KEY}" ]]; then
  LANGSMITH_TRACING="${LANGSMITH_TRACING:-true}"
  ask_if_missing LANGSMITH_PROJECT  "Nombre del proyecto en LangSmith" "dm-agent" "no"
  LANGSMITH_PROJECT="${LANGSMITH_PROJECT:-dm-agent}"
  info "¿Región de tu cuenta LangSmith?"
  echo "  [eu] EU  → https://eu.api.smith.langchain.com"
  echo "  [us] US  → https://api.smith.langchain.com"
  if [[ -z "${LANGSMITH_ENDPOINT:-}" ]]; then
    read -rp "  Región [eu/us]: " LS_REGION
    case "${LS_REGION,,}" in
      us) LANGSMITH_ENDPOINT="https://api.smith.langchain.com" ;;
      *)  LANGSMITH_ENDPOINT="https://eu.api.smith.langchain.com" ;;
    esac
  fi
else
  LANGSMITH_TRACING=""
  LANGSMITH_PROJECT="${LANGSMITH_PROJECT:-dm-agent}"
  LANGSMITH_ENDPOINT="${LANGSMITH_ENDPOINT:-https://eu.api.smith.langchain.com}"
fi

# ── 7. Escribir .env ─────────────────────────────────────────
cat > "$ENV_FILE" <<ENVEOF
# N8N Production — generado/actualizado $(date '+%Y-%m-%d %H:%M')
# NO subir este archivo al repo
# ---- Dominios -----------------------------------------------
N8N_HOST=${N8N_HOST}
MINIO_DOMAIN=${MINIO_DOMAIN}
MINIO_CONSOLE_DOMAIN=${MINIO_CONSOLE_DOMAIN}
API_HOST=${API_HOST}
DASHBOARD_HOST=${DASHBOARD_HOST}
# ---- Red Traefik --------------------------------------------
TRAEFIK_NETWORK=${TRAEFIK_NETWORK}
# ---- PostgreSQL ---------------------------------------------
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
# ---- Redis --------------------------------------------------
REDIS_PASSWORD=${REDIS_PASSWORD}
# ---- n8n — NO cambiar esta clave después del primer deploy --
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
# ---- MinIO --------------------------------------------------
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
MINIO_PUBLIC_URL=https://${MINIO_DOMAIN}
MINIO_BUCKET_ASSETS=assets
# ---- API DM Setter ------------------------------------------
API_IMAGE=dm-api:local
MC_WEBHOOK_TOKEN=${MC_WEBHOOK_TOKEN}
N8N_CALLBACK_TOKEN=${N8N_CALLBACK_TOKEN}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
# ---- Dashboard ----------------------------------------------
DASHBOARD_IMAGE=dm-dashboard:local
PANEL_PASSWORD=${PANEL_PASSWORD}
PANEL_JWT_SECRET=${PANEL_JWT_SECRET}
# ---- GitHub backup de workflows n8n -------------------------
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_OWNER=${GITHUB_OWNER}
GITHUB_REPO=${GITHUB_REPO}
GITHUB_BRANCH=${GITHUB_BRANCH}
GITHUB_PATH=${GITHUB_PATH}
# ---- Escalado a humano (Telegram) ---------------------------
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_DEFAULT_CHAT_ID=${TELEGRAM_DEFAULT_CHAT_ID}
# Registrar una vez tras deploy: bash scripts/telegram-set-webhook.sh
TELEGRAM_WEBHOOK_SECRET=${TELEGRAM_WEBHOOK_SECRET}
# Recordatorio periódico de leads pausados (horas, 0 = desactivado)
PAUSE_REMINDER_HOURS=${PAUSE_REMINDER_HOURS}
FOLLOWUP_INTERVAL_MINUTES=${FOLLOWUP_INTERVAL_MINUTES:-5}
# ---- Calendly — agendamiento (requiere plan de pago) ---------
# Registrar una vez tras deploy: bash scripts/calendly-set-webhook.sh
CALENDLY_PERSONAL_TOKEN=${CALENDLY_PERSONAL_TOKEN}
CALENDLY_ORG_URI=${CALENDLY_ORG_URI}
# ---- Motor de diálogo (Anthropic) ---------------------------
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTHROPIC_MODEL=${ANTHROPIC_MODEL}
AGENT_TIMEOUT_MS=${AGENT_TIMEOUT_MS}
# ---- Observabilidad LangSmith (opcional) --------------------
# Dejar vacío para deshabilitar. La traza de negocio vive en agent_turn_traces.
LANGSMITH_TRACING=${LANGSMITH_TRACING}
LANGSMITH_API_KEY=${LANGSMITH_API_KEY}
LANGSMITH_PROJECT=${LANGSMITH_PROJECT}
LANGSMITH_ENDPOINT=${LANGSMITH_ENDPOINT}
ENVEOF
info ".env generado/actualizado."

# ── 8. Verificar Docker ──────────────────────────────────────
section "Verificando Docker..."
command -v docker &>/dev/null || error "Docker no está instalado. Ejecuta: curl -fsSL https://get.docker.com | sh"

docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active || {
  warn "Swarm no activo. Inicializando..."
  docker swarm init
}
info "Docker Swarm activo."

# ── 9. Crear red overlay traefik-public ──────────────────────
section "Configurando red overlay..."
docker network ls --format '{{.Name}}' | grep -q "^${TRAEFIK_NETWORK}$" || {
  info "Creando red overlay '${TRAEFIK_NETWORK}'..."
  docker network create --driver overlay --attachable "$TRAEFIK_NETWORK"
}
info "Red ${TRAEFIK_NETWORK} lista."

# ── 10. Instalar Traefik (si no está corriendo) ───────────────
section "Verificando Traefik..."
if ! docker service ls --format '{{.Name}}' | grep -q '^traefik$'; then
  # Traefik v2.11: el Swarm provider de v3.x usa Docker API 1.24 hardcodeada,
  # incompatible con Docker Engine 29+ (requiere mínimo 1.40). v2.11 negocia bien.
  info "Instalando Traefik v2.11..."

  mkdir -p /etc/traefik/dynamic
  touch /etc/traefik/acme.json
  chmod 600 /etc/traefik/acme.json

  cat > /etc/traefik/traefik.yml <<TRAEFIKEOF
global:
  sendAnonymousUsage: false

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    network: ${TRAEFIK_NETWORK}
    exposedByDefault: false
    swarmMode: true
    watch: true
  file:
    directory: /etc/traefik/dynamic
    watch: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

api:
  dashboard: false

log:
  level: INFO

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${ACME_EMAIL}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
TRAEFIKEOF

  docker service create \
    --name traefik \
    --detach=false \
    --constraint 'node.role==manager' \
    --publish published=80,target=80,mode=host \
    --publish published=443,target=443,mode=host \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly \
    --mount type=bind,source=/etc/traefik/traefik.yml,target=/traefik.yml \
    --mount type=bind,source=/etc/traefik/acme.json,target=/etc/traefik/acme.json \
    --mount type=bind,source=/etc/traefik/dynamic,target=/etc/traefik/dynamic \
    --network "$TRAEFIK_NETWORK" \
    traefik:v2.11 \
    --configFile=/traefik.yml

  info "Esperando que Traefik esté listo en el puerto 80..."
  TRAEFIK_WAIT=0
  until bash -c 'echo > /dev/tcp/127.0.0.1/80' 2>/dev/null; do
    echo -n "."
    sleep 2
    TRAEFIK_WAIT=$((TRAEFIK_WAIT + 2))
    [[ $TRAEFIK_WAIT -ge 120 ]] && error "Traefik no arrancó en 120s. Revisa: docker service ps traefik"
  done
  echo ""
  info "Traefik listo."
else
  info "Traefik ya está corriendo."
fi

# ── 11. Construir imagen de la API DM Setter ─────────────────
section "Construyendo imagen dm-api:local (puede tardar 1-2 min)..."
docker build \
  -t dm-api:local \
  -f "$ROOT_DIR/apps/api/Dockerfile" \
  "$ROOT_DIR"
info "Imagen dm-api:local construida."

# ── 12. Desplegar stack n8n ───────────────────────────────────
section "Desplegando stack n8n..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

docker stack deploy \
  --with-registry-auth \
  -c "$ROOT_DIR/docker-stack.yml" \
  n8n

info "Stack enviado. Esperando que los servicios arranquen..."
sleep 8
docker stack services n8n

bash "$(dirname "$0")/init-minio-bucket.sh" || warn "init-minio-bucket falló — corrígelo a mano con: bash scripts/init-minio-bucket.sh"

# ── 13. Registrar webhook de Telegram ────────────────────────
section "Registrando webhook de Telegram..."
bash "$(dirname "$0")/telegram-set-webhook.sh" && info "Webhook de Telegram registrado." \
  || warn "Telegram webhook falló. Correr a mano: bash scripts/telegram-set-webhook.sh"

# ── 14. Registrar webhook de Calendly ────────────────────────
section "Registrando webhook de Calendly..."
bash "$(dirname "$0")/calendly-set-webhook.sh" && info "Webhook de Calendly registrado." \
  || warn "Calendly webhook falló. Correr a mano: bash scripts/calendly-set-webhook.sh"

section "COMPLETADO"
echo ""
echo -e "  Panel n8n:      ${GREEN}https://${N8N_HOST}${NC}"
echo -e "  MinIO S3:       ${GREEN}https://${MINIO_DOMAIN}${NC}"
echo -e "  MinIO Consola:  ${GREEN}https://${MINIO_CONSOLE_DOMAIN}${NC}"
echo -e "  API DM Setter:  ${GREEN}https://${API_HOST}${NC}"
echo -e "  Dashboard:      ${GREEN}https://${DASHBOARD_HOST}${NC}"
echo ""
echo -e "  ${YELLOW}Credenciales en: ${ROOT_DIR}/.env${NC}"
if [[ "$MODE" == "fresh" ]]; then
  echo -e "  ${YELLOW}MinIO user:       ${MINIO_ROOT_USER}${NC}"
  echo -e "  ${YELLOW}MinIO pass:       ${MINIO_ROOT_PASSWORD}${NC}"
  echo -e "  ${YELLOW}Dashboard pass:   ${PANEL_PASSWORD}${NC}"
  echo -e "  ${YELLOW}GitHub backup:    ${GITHUB_OWNER}/${GITHUB_REPO} → ${GITHUB_PATH}/${NC}"
  echo ""
  echo -e "  ${YELLOW}MC_WEBHOOK_TOKEN (config en ManyChat header X-MC-Token):${NC}"
  echo -e "  ${YELLOW}  ${MC_WEBHOOK_TOKEN}${NC}"
fi
echo ""
warn "Los certificados SSL pueden tardar 1-2 minutos en generarse."
warn "Si los dominios no apuntaban al servidor: docker service update --force traefik"
echo ""
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
warn "  PASO MANUAL OBLIGATORIO — TELEGRAM:"
warn "  El agente debe abrir el bot en Telegram y enviar /start"
warn "  antes de que llegue la primera notificación de escalado."
warn "  Sin este paso, Telegram devuelve 403 Forbidden silenciosamente."
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Próximos pasos:"
echo "  1. El agente envía /start al bot de Telegram (ver aviso arriba)"
echo "  2. Crear el primer tenant:"
echo "       make seed-tenant SLUG=dev N8N_WORKFLOW_URL=https://${N8N_HOST}/webhook/agent-run"
echo "  3. Verificar que la API responde:"
echo "       curl https://${API_HOST}/healthz"
echo "  4. Crear workflow 'agent-run' en n8n con webhook trigger"
echo "  5. Configurar External Request en ManyChat:"
echo "       URL:    https://${API_HOST}/webhook/manychat"
echo "       Header: X-MC-Token: (ver .env MC_WEBHOOK_TOKEN)"
echo ""
info "Comandos útiles:"
echo "  make status             — estado de servicios"
echo "  make logs-main          — logs del panel n8n"
echo "  make logs-worker        — logs de los workers n8n"
echo "  make logs-api           — logs de la API"
echo "  make logs-api-worker    — logs del worker BullMQ"
echo "  make scale-workers N=5  — escalar workers n8n a 5"
echo "  make scale-api N=2      — escalar API a 2 réplicas"
echo "  make migrate            — re-aplicar migraciones drizzle"
echo "  make rebuild-api        — reconstruir imagen dm-api:local"
