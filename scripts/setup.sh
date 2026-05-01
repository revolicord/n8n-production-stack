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

[[ -z "$N8N_HOST" ]]             && error "Panel n8n es obligatorio."
[[ -z "$MINIO_DOMAIN" ]]         && error "MinIO S3 es obligatorio."
[[ -z "$MINIO_CONSOLE_DOMAIN" ]] && error "MinIO Consola es obligatorio."

TRAEFIK_NETWORK="traefik-public"

# ── 3. Generar credenciales ──────────────────────────────────
section "Generando credenciales seguras..."
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 32)
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 32)
MINIO_ROOT_USER="minio_admin"

# ── 4. Escribir .env ─────────────────────────────────────────
cat > "$ENV_FILE" <<ENVEOF
# N8N Production — generado $(date '+%Y-%m-%d %H:%M')
# NO subir este archivo al repo
# ---- Dominios -----------------------------------------------
N8N_HOST=${N8N_HOST}
MINIO_DOMAIN=${MINIO_DOMAIN}
MINIO_CONSOLE_DOMAIN=${MINIO_CONSOLE_DOMAIN}
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
  info "Instalando Traefik v3.3..."

  mkdir -p /etc/traefik/dynamic
  touch /etc/traefik/acme.json
  chmod 600 /etc/traefik/acme.json

  # Configuración de Traefik v3 con Swarm provider
  cat > /etc/traefik/traefik.yml <<TRAEFIKEOF
global:
  sendAnonymousUsage: false

providers:
  swarm:
    endpoint: "unix:///var/run/docker.sock"
    network: ${TRAEFIK_NETWORK}
    exposedByDefault: false
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
    --constraint 'node.role==manager' \
    --publish published=80,target=80,mode=host \
    --publish published=443,target=443,mode=host \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly \
    --mount type=bind,source=/etc/traefik/traefik.yml,target=/traefik.yml \
    --mount type=bind,source=/etc/traefik/acme.json,target=/acme.json \
    --mount type=bind,source=/etc/traefik/dynamic,target=/etc/traefik/dynamic \
    --network "$TRAEFIK_NETWORK" \
    traefik:v3.3 \
    --configFile=/traefik.yml

  info "Traefik instalado. Esperando 15s para que arranque..."
  sleep 15
else
  info "Traefik ya está corriendo."
fi

# ── 8. Desplegar stack n8n ───────────────────────────────────
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

section "INSTALACIÓN COMPLETA"
echo ""
echo -e "  Panel n8n:      ${GREEN}https://${N8N_HOST}${NC}"
echo -e "  MinIO S3:       ${GREEN}https://${MINIO_DOMAIN}${NC}"
echo -e "  MinIO Consola:  ${GREEN}https://${MINIO_CONSOLE_DOMAIN}${NC}"
echo ""
echo -e "  ${YELLOW}Credenciales guardadas en: ${ROOT_DIR}/.env${NC}"
echo -e "  ${YELLOW}MinIO user: ${MINIO_ROOT_USER}${NC}"
echo -e "  ${YELLOW}MinIO pass: ${MINIO_ROOT_PASSWORD}${NC}"
echo ""
info "Comandos útiles:"
echo "  make status             — estado de servicios"
echo "  make logs-main          — logs del panel n8n"
echo "  make logs-worker        — logs de los workers"
echo "  make scale-workers N=5  — escalar workers a 5"
echo ""
warn "Los certificados SSL pueden tardar 1-2 minutos en generarse."
warn "Si los dominios no apuntaban al servidor, reiniciar Traefik: docker service update --force traefik"
