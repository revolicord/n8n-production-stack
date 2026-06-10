#!/usr/bin/env bash
# Registra el webhook de callbacks de Telegram (botones de las alertas de
# escalado). Idempotente: ejecutar una vez tras configurar TELEGRAM_* en .env.
#
# Uso: bash scripts/telegram-set-webhook.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source .env

: "${TELEGRAM_BOT_TOKEN:?Falta TELEGRAM_BOT_TOKEN en .env}"
: "${TELEGRAM_WEBHOOK_SECRET:?Falta TELEGRAM_WEBHOOK_SECRET en .env}"
: "${API_HOST:?Falta API_HOST en .env}"

URL="https://${API_HOST}/webhook/telegram"

echo "Registrando webhook: ${URL}"
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${URL}" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "allowed_updates=[\"callback_query\"]"
echo
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
