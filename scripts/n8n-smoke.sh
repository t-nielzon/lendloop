#!/usr/bin/env bash
# brings up only n8n, its import job and mailpit with throwaway secrets, then checks the signed webhook end to end.
# host ports and the project name are overridable so it can run beside a developer stack.
set -euo pipefail
cd "$(dirname "$0")/.."

project="${SMOKE_PROJECT:-lendloop-ci}"
n8n_port="${N8N_HOST_PORT:-5678}"
mail_port="${MAILPIT_HTTP_PORT:-8025}"
envfile="$(mktemp)"
rand() { openssl rand -hex 32; }
compose() { docker compose -p "$project" --env-file "$envfile" "$@"; }

outbound="$(rand)"
previous="$(rand)"
cat > "$envfile" <<ENV
N8N_ENCRYPTION_KEY=$(rand)
LENDLOOP_OUTBOUND_SECRET=${outbound}
LENDLOOP_INBOUND_SECRET=$(rand)
LENDLOOP_OUTBOUND_SECRET_PREVIOUS=${previous}
N8N_HOST_PORT=${n8n_port}
MAILPIT_HTTP_PORT=${mail_port}
MAILPIT_SMTP_PORT=${MAILPIT_SMTP_PORT:-1025}
ENV

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "smoke test failed (exit $status), recent n8n logs:" >&2
    compose logs --tail 80 n8n >&2 || true
  fi
  compose down -v >/dev/null 2>&1 || true
  rm -f "$envfile"
  exit "$status"
}
trap cleanup EXIT

url="http://127.0.0.1:${n8n_port}/webhook/lendloop/loan-status"
post() { # secret -> http status of a signed post, a fresh event id each time
  local cmd
  cmd="$(node scripts/sign-request.mjs "$1" "$url")"
  sh -c "${cmd} --max-time 20 -s -o /dev/null -w '%{http_code}'"
}
mail_total() {
  curl -fsS --max-time 5 "http://127.0.0.1:${mail_port}/api/v1/messages" | grep -o '"total":[0-9]*' | head -n1 | cut -d: -f2
}
expect_status() { # label expected actual
  if [ "$3" != "$2" ]; then echo "$1: expected HTTP $2, got $3" >&2; exit 1; fi
  echo "ok: $1 -> $3"
}

compose up -d mailpit n8n-import n8n

# one bounded wait for n8n to serve requests (import runs first, then the main process starts)
ready=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${n8n_port}/healthz" >/dev/null 2>&1; then ready=1; break; fi
  sleep 3
done
[ -n "$ready" ] || { echo "n8n did not become healthy in time" >&2; exit 1; }

expect_status "signed request" 200 "$(post "$outbound")"
# the notification is sent asynchronously after the webhook answers
sent=0
for _ in $(seq 1 20); do
  sent="$(mail_total || echo 0)"
  [ "${sent:-0}" -ge 1 ] && break
  sleep 1
done
[ "${sent:-0}" -ge 1 ] || { echo "no message reached mailpit" >&2; exit 1; }
echo "ok: mailpit holds ${sent} message(s)"

expect_status "unsigned request" 401 "$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-raw '{"eventId":"evt-unsigned"}' "$url")"
expect_status "wrong secret" 401 "$(post "$(rand)")"
expect_status "previous secret" 200 "$(post "$previous")"

count="$(compose exec -T -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n list:workflow | grep -c '|')"
[ "$count" -eq 6 ] || { echo "expected 6 workflows, found $count" >&2; exit 1; }
echo "ok: six workflows imported"
