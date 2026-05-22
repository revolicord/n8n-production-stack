#!/usr/bin/env bash
set -e

CONTAINER=$(docker ps --format "{{.Names}}" | grep postgres)

if [ -z "$CONTAINER" ]; then
  echo "ERROR: No se encontró el contenedor de postgres."
  exit 1
fi

echo "Borrando datos en $CONTAINER..."

docker exec "$CONTAINER" psql -U n8n -d n8n -c "
BEGIN;
TRUNCATE api.turns, api.messages_raw, api.lead_followup_log, api.stage_transitions, api.lead_stages, api.lead_crons, api.lead_content_sent, api.dead_letter_queue, api.conversations, api.subscribers RESTART IDENTITY CASCADE;
TRUNCATE n8n_chat_histories RESTART IDENTITY CASCADE;
COMMIT;
"

echo "Listo. Todo borrado."
