#!/usr/bin/env bash
# Creates the public assets bucket in MinIO and enables anonymous download.
# Idempotent — safe to run multiple times.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${1:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] .env not found at $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_USER="${MINIO_ROOT_USER:?MINIO_ROOT_USER required}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD required}"
BUCKET="${MINIO_BUCKET:-assets}"

echo "[INFO] Configuring MinIO bucket: ${BUCKET} at ${MINIO_ENDPOINT}"

docker run --rm \
  --network host \
  --entrypoint /bin/sh \
  minio/mc:latest \
  -c "mc alias set local '${MINIO_ENDPOINT}' '${MINIO_USER}' '${MINIO_PASS}' --quiet && \
      mc mb --ignore-existing local/${BUCKET} && \
      mc anonymous set download local/${BUCKET} && \
      echo '[INFO] Bucket ${BUCKET} ready with public download'"
