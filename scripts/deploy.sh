#!/usr/bin/env bash
# Despliega o actualiza el stack n8n en Docker Swarm.
# Uso: ./scripts/deploy.sh
set -euo pipefail

STACK_NAME="n8n"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
STACK_FILE="$ROOT_DIR/docker-stack.yml"

# ── Colores ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Prerequisitos ─────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || error ".env no encontrado. Copia .env.example → .env y rellena los valores."

# Cargar variables de entorno
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Validar que las variables obligatorias no estén vacías
REQUIRED_VARS=(POSTGRES_PASSWORD N8N_ENCRYPTION_KEY REDIS_PASSWORD MINIO_ROOT_PASSWORD N8N_HOST MINIO_DOMAIN MINIO_CONSOLE_DOMAIN TRAEFIK_NETWORK)
for var in "${REQUIRED_VARS[@]}"; do
  [[ -z "${!var:-}" ]] && error "Variable $var está vacía en .env"
  [[ "${!var}" == *"CAMBIA_ESTO"* ]] && error "Variable $var aún tiene el valor de ejemplo. Cámbiala en .env."
done

# Verificar Swarm
docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active || \
  error "Docker Swarm no está activo. Ejecuta: docker swarm init"

# Verificar red Traefik
docker network ls --format '{{.Name}}' | grep -q "^${TRAEFIK_NETWORK}$" || \
  error "Red '$TRAEFIK_NETWORK' no existe. ¿Está Traefik iniciado en Dokploy?"

info "Desplegando stack '$STACK_NAME'..."
docker stack deploy \
  --with-registry-auth \
  --detach=false \
  -c "$STACK_FILE" \
  "$STACK_NAME"

info "Stack desplegado. Estado de servicios:"
sleep 3
docker stack services "$STACK_NAME"

echo ""
info "Comandos útiles:"
echo "  Ver logs worker:   docker service logs -f ${STACK_NAME}_n8n-worker"
echo "  Ver logs webhook:  docker service logs -f ${STACK_NAME}_n8n-webhook"
echo "  Escalar workers:   docker service scale ${STACK_NAME}_n8n-worker=5"
echo "  Estado:            docker stack services $STACK_NAME"
