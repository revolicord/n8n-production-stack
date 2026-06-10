#!/usr/bin/env bash
# ============================================================
# SETUP — Instalación completa n8n en producción (Docker Swarm)
# Uso: bash scripts/setup.sh
#
# Requisitos previos:
#   - Ubuntu 22.04 / Debian 12
#   - Puertos 80 y 443 libres y abiertos en el firewall
#   - DNS de los 3 subdominios apuntando a la IP del servidor
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

# ── 1. Verificar .env ────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  warn ".env ya existe. ¿Sobreescribir? (s/N)"
  read -r CONFIRM
  [[ "$CONFIRM" =~ ^[sS]$ ]] || { info "Abortado."; exit 0; }
fi

section "INSTALACIÓN N8N PRODUCCIÓN — DOCKER SWARM + TRAEFIK"

# ── 2. Pedir datos ───────────────────────────────────────────
echo ""
info "Ingresa el email para Let's Encrypt (certificados SSL):"
read -rp "  Email: " ACME_EMAIL
[[ -z "$ACME_EMAIL" ]] && error "Email es obligatorio para SSL."

echo ""
info "Ingresa los subdominios (sin https://):"
echo ""
read -rp "  Panel n8n        (ej: n8n.tudominio.com):           " N8N_HOST
read -rp "  MinIO S3         (ej: minio.tudominio.com):         " MINIO_DOMAIN
read -rp "  MinIO Consola    (ej: minio-console.tudominio.com): " MINIO_CONSOLE_DOMAIN
read -rp "  API DM Setter    (ej: api.tudominio.com):           " API_HOST
read -rp "  Dashboard        (ej: dashboard.tudominio.com):     " DASHBOARD_HOST

[[ -z "$N8N_HOST" ]]             && error "Panel n8n es obligatorio."
[[ -z "$MINIO_DOMAIN" ]]         && error "MinIO S3 es obligatorio."
[[ -z "$MINIO_CONSOLE_DOMAIN" ]] && error "MinIO Consola es obligatorio."
[[ -z "$API_HOST" ]]             && error "API host es obligatorio."
[[ -z "$DASHBOARD_HOST" ]]       && error "Dashboard host es obligatorio."

TRAEFIK_NETWORK="traefik-public"

# ── 3. Generar credenciales ──────────────────────────────────
section "Generando credenciales seguras..."
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 32)
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 32)
MINIO_ROOT_USER="minio_admin"

# Tokens de la API DM Setter
MC_WEBHOOK_TOKEN=$(openssl rand -hex 32)
N8N_CALLBACK_TOKEN=$(openssl rand -hex 32)
ADMIN_JWT_SECRET=$(openssl rand -hex 64)
ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)

# Dashboard
PANEL_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)
PANEL_JWT_SECRET=$(openssl rand -hex 64)

# ── 3b. GitHub backup de workflows ──────────────────────────
section "Configuración de backup de workflows a GitHub..."
echo ""
info "Necesitas un Personal Access Token (PAT) de GitHub con permisos Contents: Read/Write"
info "Crear en: GitHub → Settings → Developer settings → Fine-grained tokens"
echo ""
read -rp "  GitHub PAT token: " GITHUB_TOKEN
[[ -z "$GITHUB_TOKEN" ]] && error "GitHub token es obligatorio para el backup de workflows."
read -rp "  GitHub owner/org [revolicord]: " GITHUB_OWNER
GITHUB_OWNER="${GITHUB_OWNER:-revolicord}"
read -rp "  GitHub repo [n8n-production-stack]: " GITHUB_REPO
GITHUB_REPO="${GITHUB_REPO:-n8n-production-stack}"
read -rp "  Branch [master]: " GITHUB_BRANCH
GITHUB_BRANCH="${GITHUB_BRANCH:-master}"
read -rp "  Carpeta de workflows [n8n-workflows]: " GITHUB_PATH
GITHUB_PATH="${GITHUB_PATH:-n8n-workflows}"

# ── 4. Escribir .env ─────────────────────────────────────────
cat > "$ENV_FILE" <<ENVEOF
# N8N Production — generado $(date '+%Y-%m-%d %H:%M')
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
ADMIN_PASSWORD=${ADMIN_PASSWORD}
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
ENVEOF
info ".env generado."

# ── 5. Verificar Docker ──────────────────────────────────────
section "Verificando Docker..."
command -v docker &>/dev/null || error "Docker no está instalado. Ejecuta: curl -fsSL https://get.docker.com | sh"

docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active || {
  warn "Swarm no activo. Inicializando..."
  docker swarm init
}
info "Docker Swarm activo."

# ── 6. Crear red overlay traefik-public ──────────────────────
section "Configurando red overlay..."
docker network ls --format '{{.Name}}' | grep -q "^${TRAEFIK_NETWORK}$" || {
  info "Creando red overlay '${TRAEFIK_NETWORK}'..."
  docker network create --driver overlay --attachable "$TRAEFIK_NETWORK"
}
info "Red ${TRAEFIK_NETWORK} lista."

# ── 7. Instalar Traefik (si no está corriendo) ───────────────
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

# ── 8. Construir imagen de la API DM Setter ──────────────────
section "Construyendo imagen dm-api:local (puede tardar 1-2 min)..."
docker build \
  -t dm-api:local \
  -f "$ROOT_DIR/apps/api/Dockerfile" \
  "$ROOT_DIR"
info "Imagen dm-api:local construida."

# ── 9. Desplegar stack n8n ───────────────────────────────────
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

section "INSTALACIÓN COMPLETA"
echo ""
echo -e "  Panel n8n:      ${GREEN}https://${N8N_HOST}${NC}"
echo -e "  MinIO S3:       ${GREEN}https://${MINIO_DOMAIN}${NC}"
echo -e "  MinIO Consola:  ${GREEN}https://${MINIO_CONSOLE_DOMAIN}${NC}"
echo -e "  API DM Setter:  ${GREEN}https://${API_HOST}${NC}"
echo -e "  Dashboard:      ${GREEN}https://${DASHBOARD_HOST}${NC}"
echo ""
echo -e "  ${YELLOW}Credenciales guardadas en: ${ROOT_DIR}/.env${NC}"
echo -e "  ${YELLOW}MinIO user:       ${MINIO_ROOT_USER}${NC}"
echo -e "  ${YELLOW}MinIO pass:       ${MINIO_ROOT_PASSWORD}${NC}"
echo -e "  ${YELLOW}Dashboard pass:   ${PANEL_PASSWORD}${NC}"
echo -e "  ${YELLOW}GitHub backup:    ${GITHUB_OWNER}/${GITHUB_REPO} → ${GITHUB_PATH}/${NC}"
echo ""
echo -e "  ${YELLOW}MC_WEBHOOK_TOKEN (config en ManyChat header X-MC-Token):${NC}"
echo -e "  ${YELLOW}  ${MC_WEBHOOK_TOKEN}${NC}"
echo ""
info "Próximos pasos:"
echo "  1. Crear el primer tenant:"
echo "       make seed-tenant SLUG=dev N8N_WORKFLOW_URL=https://${N8N_HOST}/webhook/agent-run"
echo "  2. Verificar que la API responde:"
echo "       curl https://${API_HOST}/healthz"
echo "  3. Crear workflow 'agent-run' en n8n con webhook trigger"
echo "  4. Configurar External Request en ManyChat:"
echo "       URL:    https://${API_HOST}/webhook/manychat"
echo "       Header: X-MC-Token: <ver arriba>"
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
echo ""
warn "Los certificados SSL pueden tardar 1-2 minutos en generarse."
warn "Si los dominios no apuntaban al servidor, reiniciar Traefik: docker service update --force traefik"
