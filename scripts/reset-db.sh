#!/usr/bin/env bash
set -e

CONTAINER=$(docker ps --format "{{.Names}}" | grep postgres | grep -v "dev-" | head -n 1)

if [ -z "$CONTAINER" ]; then
  echo "ERROR: No se encontró el contenedor de postgres."
  exit 1
fi

echo "Borrando datos en $CONTAINER..."

docker exec "$CONTAINER" psql -U n8n -d n8n -c "
BEGIN;
TRUNCATE api.turns, api.messages_raw, api.lead_followup_log, api.stage_transitions, api.lead_stages, api.lead_crons, api.lead_content_sent, api.dead_letter_queue, api.conversations, api.subscribers RESTART IDENTITY CASCADE;
TRUNCATE n8n_chat_histories RESTART IDENTITY CASCADE;
TRUNCATE chat_hub_messages, chat_hub_sessions, instance_ai_messages, instance_ai_threads, agents_messages, agents_threads RESTART IDENTITY CASCADE;
COMMIT;
"

REDIS_CONTAINER=$(docker ps --format "{{.Names}}" | grep redis | grep -v "dev-" | head -n 1)
if [ -n "$REDIS_CONTAINER" ]; then
  echo "Borrando caché en Redis ($REDIS_CONTAINER)..."
  docker exec "$REDIS_CONTAINER" redis-cli FLUSHALL
else
  echo "ADVERTENCIA: No se encontró el contenedor de redis. Omitiendo limpieza de caché."
fi

echo "Listo. Todo borrado como si no existieras."
