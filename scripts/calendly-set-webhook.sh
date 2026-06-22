#!/usr/bin/env bash
# Registra la suscripción de webhook de Calendly.
# Idempotente: si ya existe un webhook con la misma URL no crea un duplicado
# (Calendly devuelve error 409 que este script detecta e ignora).
#
# Requisito: plan Calendly de pago (Professional, Teams o Enterprise).
# El plan gratuito no permite webhook_subscriptions vía API.
#
# Uso: bash scripts/calendly-set-webhook.sh
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source .env

: "${CALENDLY_PERSONAL_TOKEN:?Falta CALENDLY_PERSONAL_TOKEN en .env}"
: "${CALENDLY_ORG_URI:?Falta CALENDLY_ORG_URI en .env}"
: "${API_HOST:?Falta API_HOST en .env}"

WEBHOOK_URL="https://${API_HOST}/webhook/calendly"

info "Registrando webhook de Calendly:"
info "  URL destino: ${WEBHOOK_URL}"
info "  Organización: ${CALENDLY_ORG_URI}"
info "  Eventos: invitee.created, invitee.canceled"
echo ""

RESPONSE=$(curl -sS -w "\n%{http_code}" \
  --request POST \
  --url "https://api.calendly.com/webhook_subscriptions" \
  --header "Authorization: Bearer ${CALENDLY_PERSONAL_TOKEN}" \
  --header "Content-Type: application/json" \
  --data "{
    \"url\": \"${WEBHOOK_URL}\",
    \"events\": [\"invitee.created\", \"invitee.canceled\"],
    \"organization\": \"${CALENDLY_ORG_URI}\",
    \"scope\": \"organization\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" == "201" ]]; then
  info "Webhook registrado exitosamente."
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
elif [[ "$HTTP_CODE" == "409" ]]; then
  warn "Ya existe un webhook con esa URL (409 Conflict). No se creó duplicado."
  warn "Para ver los webhooks activos ejecuta:"
  warn "  bash scripts/calendly-list-webhooks.sh"
else
  error "Error al registrar webhook (HTTP ${HTTP_CODE}):"$'\n'"${BODY}"
fi

echo ""
info "Verificando suscripciones activas:"
curl -sS \
  --url "https://api.calendly.com/webhook_subscriptions?organization=${CALENDLY_ORG_URI}&scope=organization" \
  --header "Authorization: Bearer ${CALENDLY_PERSONAL_TOKEN}" \
  | python3 -m json.tool 2>/dev/null || true
echo ""
