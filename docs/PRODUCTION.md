# Production change note

The repository runs as a local stack: self-hosted Convex, a single n8n container on SQLite, Mailpit for mail, Clerk in development mode. This note lists what changes before real members use it, in the order I would do it, and why each item matters. It also states what is deliberately left as is.

## Summary

| Area | Local | Production |
|-|-|-|
| Backend | Self-hosted Convex in compose | Convex Cloud production deployment |
| Identity | Clerk development instance | Clerk production instance on the real domain |
| Web | `pnpm dev` | Built Next.js app on a managed host, HTTPS only |
| n8n | One container, SQLite, static-data dedupe | Queue mode, Postgres, Redis, backups, durable dedupe |
| Mail | Mailpit | Transactional provider with SPF, DKIM, DMARC |
| Secrets | `.env` files, manual dual-secret rotation | Secrets manager, scheduled and audited rotation |
| Alerting | Admin console and one email | Dead-letter and failure alerts to an on-call channel |

## 1. Convex and Clerk

- Create a Convex Cloud production deployment and deploy with `npx convex deploy` from CI. Set every Convex variable from the README table on that deployment: `CLERK_JWT_ISSUER_DOMAIN`, `ADMIN_EMAILS`, `APP_URL`, `N8N_LOAN_STATUS_WEBHOOK_URL`, both HMAC secrets.
- Create a Clerk production instance on the real domain. The issuer domain, publishable key and secret key all change; production keys are not interchangeable with development keys. Recreate the `convex` JWT template (application ID `convex`) on the production instance and point `CLERK_JWT_ISSUER_DOMAIN` at it.
- Remove test sign-in shortcuts: production Clerk does not accept `+clerk_test` addresses with a fixed code. Require email verification (the admin bootstrap already depends on Clerk reporting a verified email).
- `ADMIN_EMAILS` should contain one or two named people. After the first admin exists, manage admins from the admin console and empty the variable.
- Convex Cloud HTTP actions live on the `.convex.site` origin. Set `LENDLOOP_CONVEX_SITE_URL` in n8n to it; the local default `http://convex-backend:3211` is only valid inside compose.
- Run `convex dev` only against a development deployment. Production gets code only through the deploy step.

## 2. n8n hosting

Single-container n8n with SQLite is fine locally, not for production.

- Run in queue mode: a main instance, one or more workers and Redis, with Postgres as the database. This lets the webhook keep answering while a worker sends mail, and survives a worker restart without losing queued executions.
- Put n8n behind HTTPS with a stable hostname. Set `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL=https` and `N8N_SECURE_COOKIE=true` (the compose file disables secure cookies for http on localhost). Restrict the editor UI to staff or a VPN; only `/webhook/lendloop/loan-status` needs to be reachable by Convex. The HMAC signature and the 300 second window are the access control on that path, so also rate limit it (section 6).
- Keep `N8N_ENCRYPTION_KEY` in the secrets manager, back it up separately from the database, and never regenerate it: losing it makes every stored credential unreadable. The setup script generates it only for local use.
- Back up Postgres daily with a restore test. Workflows are also in git (`n8n/workflows/`), so the definitions can be rebuilt; executions and credentials cannot.
- Execution data: set `EXECUTIONS_DATA_PRUNE=true` with a short `EXECUTIONS_DATA_MAX_AGE` (for example 72 hours) and consider `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`. Execution history contains webhook payloads with recipient emails.
- Pin the n8n image version (the compose file already does) and upgrade deliberately. Run the workflow import step against a staging instance first.
- Replace the compose-only `n8n-import` container with a deploy step that runs the same `n8n/import.sh` logic against the production instance, then restarts or publishes the workflows. Credentials are provisioned from the secrets manager, not from `n8n/credentials/`.
- The code nodes read `$env` and `crypto`, which is why `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and `NODE_FUNCTION_ALLOW_BUILTIN=crypto` are set. In production prefer n8n's external secrets or a credential-based approach for the two HMAC secrets so they are not readable from every code node.

## 3. Secrets and rotation

Four secrets matter: the two HMAC secrets, `CLERK_SECRET_KEY` and `N8N_ENCRYPTION_KEY`.

- Store them in a managed secrets store and inject them at deploy time; do not keep them in `.env` files on servers.
- HMAC rotation without downtime is implemented. Each side accepts a current and an optional previous secret (`LENDLOOP_INBOUND_SECRET_PREVIOUS` in Convex, `LENDLOOP_OUTBOUND_SECRET_PREVIOUS` in n8n), and signing always uses the current one. The commands are in the README ("Rotating the signing secrets"). In production keep the previous secret in place for at least one full retry window before removing it (the outbox gives up after about 7 hours and the signature window is 5 minutes, so 24 hours is a safe margin).
- What remains:
  1. Source the secrets from the managed store and run the rotation steps from the deploy pipeline instead of by hand.
  2. Rotate on a schedule (for example every 90 days) and immediately after any suspected exposure or staff change, automated rather than calendar-driven.
  3. Audit: record who rotated which secret and when, and alert if a previous secret stays set longer than the overlap window or if requests keep arriving signed with it.
- Because the directions use different secrets, a leak of one does not require rotating the other.
- Rotating `N8N_ENCRYPTION_KEY` means exporting credentials, re-encrypting and re-importing; plan it as a maintenance task, not a routine one.

## 4. Email

- Use a transactional provider (SES, Postmark, Resend or similar) through SMTP or its n8n node. Replace the Mailpit credential and the placeholder sender `noreply@lendloop.local` with a real address on a domain you own.
- Publish SPF and DKIM for the sending domain and a DMARC policy (start with `p=none` and reports, tighten after a few weeks). Without them, notification mail lands in spam.
- Handle bounces and complaints: subscribe to the provider's webhook and, at minimum, alert on bounce rate. Hard-bouncing addresses should be flagged so the outbox does not retry them for hours.
- Add a plain-text footer explaining why the member received the message, and a way to contact the operator. Keep emails transactional only.

## 5. Durable deduplication

Event-id dedupe currently lives in n8n workflow static data (last 500 ids). It is not shared between workers, is lost with the workflow if it is re-imported, and is only written after sending. Before production, move it to a durable store. Two options:

- n8n Data Table: keyed by `eventId`, checked before sending and written after, with a retention of a few days. Works with queue mode.
- Convex receipt check: add a signed route (for example `/n8n/notification-sent`) that records a receipt for the `eventId` in `webhookReceipts`, and call a matching check route before sending. This reuses the existing idempotency pattern and keeps the state next to the outbox, at the cost of one more round trip.

Either way, keep the order: check, send, then record. The remaining duplicate window is a crash between send and record; closing it fully needs provider-side idempotency keys, which most transactional providers support via a message id.

## 6. HTTP hardening and rate limiting

- Convex HTTP routes already require a valid signature, a fresh timestamp and a bounded body, and fail closed. They have no rate limit, and signature verification itself costs CPU. Put a rate limit in front of `/n8n/*` (the CDN or WAF if one is used, otherwise the Convex rate-limiter component), for example 60 requests per minute per route, well above the single daily run plus error reports.
- Add the same on n8n's webhook path at the reverse proxy: a request-per-minute limit per source and a body size limit that matches Convex's 64 KiB.
- Set security headers on the Next.js app (CSP, HSTS, frame-ancestors, referrer policy), and review the Clerk and Convex origins in the CSP.
- Add a replay guard if the 5 minute window is considered too wide: reject signatures seen before (the `eventId` check on the n8n side already covers the notification route).

## 7. Observability and alerting

- Dead letters: alert when any `outbox` row reaches `dead` (the `notification_failed` event is the hook) and when pending rows are older than 15 minutes. The delivery health workflow already emails `LENDLOOP_ALERT_EMAIL` once per incident (dead rows, or pending rows older than 30 minutes) and records it in the admin Health alerts tab. What remains is routing that alert to a pager or chat channel and tightening the stuck threshold if needed.
- Workflow failures: the error handler already writes to `automationErrors` and emails an address. Point that address at a shared mailbox or forward it to the on-call channel.
- Metrics to track: deliveries per hour, delivery latency (outbox `createdAt` to `deliveredAt`), attempts per delivered row, dead count, reminder run duration and failed count, n8n queue depth and worker health, SMTP bounce rate.
- Logs: forward Convex logs through a log drain and n8n logs to the platform's log store. Do not log recipient emails or payload bodies.
- Heartbeat: have the daily reminder run report success to an uptime monitor, so a silently stopped schedule is noticed.

## 8. Time zones

Dates are stored as `YYYY-MM-DD` and validated against the UTC date on the server. The reminder run computes its date in `GENERIC_TIMEZONE`. Before serving members across zones:

- Store a time zone per community (or per tool) and evaluate "today", "past start date" and "overdue" in that zone, in Convex and in the n8n schedule.
- Make the schedule match: n8n runs at 09:00 in its own zone, so set `GENERIC_TIMEZONE` to the community zone.
- Show dates in the UI with the zone stated.

## 9. Data retention and privacy

Proposed defaults, to be confirmed against the operator's policy:

| Data | Retention |
|-|-|
| `outbox` rows, delivered | 30 days, then delete (payload holds the recipient email) |
| `outbox` rows, dead | 90 days, or until resolved |
| `webhookReceipts` | 90 days, longer than any realistic retry or rerun |
| `automationErrors` | 90 days |
| `loanEvents` and `loans` | Keep while the account exists; anonymize on deletion |
| n8n executions | 72 hours, errors 14 days |

- Implement the cleanup as a Convex cron that deletes in bounded batches, similar to the existing sweep.
- Deletion requests: subscribe to Clerk `user.deleted` webhooks (a signed Convex HTTP route verifying the Svix signature). On deletion, remove the user's `users` row, anonymize `name` and `email`, cancel open requests, and delete their `outbox` rows. Loans and events can remain with the actor shown as "former member" so other members' history stays intact.
- Sign a data processing agreement with Clerk, Convex, the email provider and the n8n host, and list them as sub-processors in the privacy notice. Check where each stores data against the community's jurisdiction.
- Keep the data-minimization properties: no owner identity in the public catalog, first names between users, minimal webhook payload. Reviews of new fields should check them.

## 10. CI and quality gates

Run on every pull request:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test` (Convex functions, signing, workflow JSON checks)
5. `pnpm build`
6. Workflow import smoke test (in place today as the `n8n-smoke` job): start n8n and Mailpit with generated secrets, import and publish the six workflows, post a correctly signed sample event and assert 200 with one message in Mailpit, an unsigned request returns 401, a previous-secret signature returns 200, and all six workflows are listed.
7. Secret scan on the diff and on the exported workflow files.

Deploy on merge to the main branch: Convex deploy, Next.js deploy, then n8n workflow import to production, in that order.

## 11. Rollout and migration

1. Provision the Clerk production instance, the Convex production deployment and the secrets store. Generate fresh secrets; do not reuse local ones.
2. Deploy Convex with all environment variables set, with `N8N_LOAN_STATUS_WEBHOOK_URL` left unset. Deliveries will defer without consuming attempts, which is safe.
3. Stand up n8n (Postgres, Redis, workers), import the workflows, load the SMTP credential, set the n8n environment variables, and run the signed sample event against it with a test recipient.
4. Set `N8N_LOAN_STATUS_WEBHOOK_URL` in Convex. The next sweep (within 5 minutes) delivers anything that was deferred.
5. Deploy the web app. Sign in as the first admin from `ADMIN_EMAILS`, check the admin outbox and error screens are empty and run one full loan with real mailboxes.
6. Trigger the reminder workflow manually once with a loan that is overdue and verify the `reminder_sent` event and that a second run finds nothing.
7. Enable alerts and the retention crons, then open signup.

Schema changes after launch follow Convex's normal rules: add optional fields first, backfill with an internal mutation, then tighten. Changes to the webhook payload must be additive, since n8n workflows may lag a deploy by minutes; bump a `type` or add a field rather than reshaping existing ones.

Rollback: Convex functions and the Next.js app roll back through redeploying the previous commit. Workflows roll back by importing the previous JSON from git. The outbox absorbs any n8n downtime during a rollback, up to about seven hours of automatic retries plus the manual retry in the admin console.

## Left as is on purpose

- The Convex outbox pattern, 6-attempt backoff and 5 minute sweep. They fit a low-volume community app; revisit only if sends per hour grow by orders of magnitude.
- First-name-only display and the 30-day maximum loan span.
- No push or SMS channel: email is the only notification path.
