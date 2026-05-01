#!/usr/bin/env bash
# Backup de PostgreSQL y MinIO con retención de 7 días.
# Uso: ./scripts/backup.sh
# Cron sugerido: 0 2 * * * /root/n8n-production/scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
BACKUP_DIR="/var/backups/n8n"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
info()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || error ".env no encontrado."
set -a; source "$ENV_FILE"; set +a

mkdir -p "$BACKUP_DIR/postgres" "$BACKUP_DIR/minio"

# ── PostgreSQL ────────────────────────────────────────────────
info "Iniciando backup de PostgreSQL..."
PG_CONTAINER=$(docker ps --filter "name=n8n_postgres" --format "{{.ID}}" | head -1)
[[ -z "$PG_CONTAINER" ]] && error "Container postgres no encontrado. ¿Está el stack corriendo?"

DUMP_FILE="$BACKUP_DIR/postgres/n8n_${DATE}.sql.gz"
docker exec "$PG_CONTAINER" \
  pg_dump -U n8n n8n | gzip > "$DUMP_FILE"

DUMP_SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
info "PostgreSQL backup: $DUMP_FILE ($DUMP_SIZE)"

# ── MinIO ─────────────────────────────────────────────────────
info "Iniciando backup de MinIO..."
MINIO_BACKUP_DIR="$BACKUP_DIR/minio/$DATE"
mkdir -p "$MINIO_BACKUP_DIR"

docker run --rm \
  --network n8n_n8n_internal \
  -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
  -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  -v "$MINIO_BACKUP_DIR:/backup" \
  minio/mc:latest \
  /bin/sh -c "
    mc alias set local http://minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD &&
    mc mirror local/n8n-data /backup/
  "

MINIO_SIZE=$(du -sh "$MINIO_BACKUP_DIR" | cut -f1)
info "MinIO backup: $MINIO_BACKUP_DIR ($MINIO_SIZE)"

# ── Rotación de backups antiguos ──────────────────────────────
info "Eliminando backups con más de $RETENTION_DAYS días..."
find "$BACKUP_DIR/postgres" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR/minio" -mindepth 1 -maxdepth 1 -type d -mtime +$RETENTION_DAYS \
  -exec rm -rf {} +

info "Backup completado. Archivos en $BACKUP_DIR"
ls -lh "$BACKUP_DIR/postgres/" | tail -5
