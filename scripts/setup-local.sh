#!/usr/bin/env bash
# brings up the local stack and prints the commands that connect convex dev to it.
set -euo pipefail
cd "$(dirname "$0")/.."

rand() { openssl rand -hex 32; }

# fill a blank or missing KEY in .env without touching values the developer already set
ensure_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=.+" .env; then return; fi
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi
ensure_var LENDLOOP_OUTBOUND_SECRET "$(rand)"
ensure_var LENDLOOP_INBOUND_SECRET "$(rand)"
ensure_var N8N_ENCRYPTION_KEY "$(rand)"
ensure_var LENDLOOP_CONVEX_SITE_URL "http://convex-backend:3211"
ensure_var LENDLOOP_ALERT_EMAIL "alerts@example.com"
ensure_var GENERIC_TIMEZONE "UTC"

docker compose up -d --wait

admin_key="$(docker compose exec -T convex-backend ./generate_admin_key.sh | tail -n 1)"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

cat <<MSG

stack is up: convex 3210/3211, dashboard http://localhost:6791, n8n http://localhost:5678, mailpit http://localhost:8025

1) run convex dev against the local backend:
   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 CONVEX_SELF_HOSTED_ADMIN_KEY='${admin_key}' npx convex dev

2) set the convex-side variables (same env vars as above):
   npx convex env set LENDLOOP_OUTBOUND_SECRET '${LENDLOOP_OUTBOUND_SECRET}'
   npx convex env set LENDLOOP_INBOUND_SECRET '${LENDLOOP_INBOUND_SECRET}'
   npx convex env set N8N_LOAN_STATUS_WEBHOOK_URL 'http://n8n:5678/webhook/lendloop/loan-status'
   npx convex env set APP_URL 'http://localhost:3000'
   (also CLERK_JWT_ISSUER_DOMAIN and ADMIN_EMAILS, see .env.example)

3) smoke test the webhook with a signed request:
   node scripts/sign-request.mjs "\$LENDLOOP_OUTBOUND_SECRET" http://localhost:5678/webhook/lendloop/loan-status
MSG
