# Architecture

This document goes deeper than the README on the data model, the delivery pipeline and the n8n contract. Everything here is taken from `convex/` and `n8n/workflows/`.

## Responsibilities

| Component | Owns |
|-|-|
| Next.js | Pages, Clerk proxy in `src/proxy.ts` (everything except `/`, `/sign-in`, `/sign-up` requires sign-in), UI state |
| Clerk | Identity, sessions, the `convex` JWT |
| Convex | All data, all authorization, loan rules, the outbox, the cron sweep, signed HTTP routes for n8n |
| n8n | Rendering and sending email, the daily schedule, reporting its own failures. It holds no business state except a short list of processed event ids |

The rule that keeps this simple: Convex decides what is true and what must be sent; n8n only performs delivery and reports back. n8n never reads the database and never changes a loan, apart from recording that a reminder went out.

## Data model

| Table | Key fields | Notes |
|-|-|-|
| `users` | `tokenIdentifier`, `name`, `email`, `role` (`admin` or `user`) | Created on first sign-in by `users.store`. Index `by_token`, `by_email`. Role is only set at creation |
| `tools` | `ownerId`, `name`, `description`, `category`, `condition`, `status` (`active` or `archived`) | Search index on `name`, filterable by status and category. Archived tools stay for history |
| `loans` | `toolId`, `ownerId`, `borrowerId`, `startDate`, `endDate` (`YYYY-MM-DD`), `status`, `note`, `lastReminderOn`, `reminderCount` | `ownerId` is copied from the tool at request time. Index `by_tool_status` (overlap checks), `by_borrower`, `by_owner`, `by_status_endDate` (overdue scan) |
| `loanEvents` | `loanId`, `at`, `actorType` (`user`, `automation`, `system`), `actorId`, `type`, `detail` | Append-only timeline. Types: the five statuses plus `notification_delivered`, `notification_failed`, `reminder_sent` |
| `outbox` | `eventId`, `loanId`, `payload`, `status` (`pending`, `delivered`, `dead`), `attempts`, `nextAttemptAt`, `lastError` | One row per status notification. Index `by_status`, `by_status_nextAttemptAt` |
| `webhookReceipts` | `idempotencyKey`, `kind`, `loanId`, `receivedAt` | Dedupe record for inbound n8n calls. Index `by_key` |
| `automationErrors` | `workflowName`, `nodeName`, `executionId`, `message`, `idempotencyKey` | Failures reported by the n8n error handler. Shown in the admin console |

Design choices:

- Dates are plain strings, not timestamps. A loan covers whole calendar days, and string comparison on ISO dates sorts correctly and is easy to index. The cost is that "today" is defined by the server in UTC.
- Overlap is checked against approved loans only. Pending requests may overlap each other, and the second approval is rejected at approval time.
- `loanEvents` stores references and short details, never email addresses.

## Transition pipeline

A loan transition is a single Convex mutation. In one transaction it:

1. Authorizes the actor and checks the current status.
2. Patches the loan.
3. Inserts the `loanEvents` row.
4. Builds the notification payload and inserts the `outbox` row (`pending`, `attempts: 0`, `nextAttemptAt: now`).
5. Schedules `notifications.deliver` for immediately.

Because the outbox row is written in the same transaction as the state change, a transition cannot happen without its notification being recorded, and a failure to reach n8n cannot roll back or block the user's action. If the recipient has no email address, no outbox row is created and a `notification_failed` event is written instead.

Recipient rule: `requested` and `cancelled` notify the owner; `approved`, `declined` and `returned` notify the borrower.

Payload (`loan.status_changed`): `eventId` (UUID), `occurredAt`, `loan` (`id`, `status`, `previousStatus`, `startDate`, `endDate`), `tool.name`, `recipient` (`firstName`, `email`), `link`.

## Outbox delivery

`notifications.deliver` is an action that sends one row:

1. Load the row. Stop if it is not `pending`.
2. `claim`: a mutation that checks the row is pending and due (`nextAttemptAt` not later than now plus 1 s), then moves `nextAttemptAt` 60 seconds ahead. This is the lease. A second `deliver` run or the sweep sees a not-due row and returns, so a row is not sent twice in parallel.
3. If `N8N_LOAN_STATUS_WEBHOOK_URL` or `LENDLOOP_OUTBOUND_SECRET` is missing, call `markUnconfigured`: record the reason, push `nextAttemptAt` 10 minutes out, do not count an attempt.
4. Sign `"<timestamp>.<body>"` and POST with a 30 second timeout. Headers: `X-LendLoop-Event-Id`, `X-LendLoop-Timestamp`, `X-LendLoop-Signature`.
5. 2xx: `markDelivered` sets `delivered`, increments attempts, writes a `notification_delivered` event.
6. Anything else: `markFailed` with `http <status>`, `timeout` or `network error`.

Backoff in `markFailed`: attempt 1 retries after 30 s, then 2 min, 10 min, 1 h, 6 h. On the sixth failed attempt the row becomes `dead` and a `notification_failed` event ("gave up after 6 attempts") is written. Total retry window is a little over seven hours.

The lease (60 s) is deliberately longer than the HTTP timeout (30 s) so a row in flight is not picked up by the sweep. The timeout is deliberately longer than n8n's own email retries (2 tries, 3 s wait) so Convex does not time out while n8n is still legitimately working.

Sweep: `crons.ts` runs `notifications.sweepPending` every 5 minutes. It takes up to 100 pending rows with `nextAttemptAt` in the past and schedules `deliver` for each. This recovers rows whose scheduled job was lost (deployment restart, crash between claim and result) and rows deferred for missing config.

Admin retry: `admin.retryDelivery` resets a `pending` or `dead` row to `pending` with zero attempts and schedules a delivery. Delivered rows cannot be retried, and a row whose delivery claim (`claimedUntil`) is still active is refused so a manual retry cannot double-send.

Guarantee: at least once. n8n's event-id check makes a repeat harmless in the normal case.

## Idempotency keys

| Direction | Key | Stored where | Behaviour on repeat |
|-|-|-|-|
| Convex to n8n | `eventId` (UUID per outbox row) | n8n workflow static data, last 500 ids | `200 {"status":"duplicate"}`, no second email |
| n8n to Convex, reminder | `overdue-reminder:<loanId>:<YYYY-MM-DD>` | `webhookReceipts` | `200 {"status":"duplicate"}`, no second increment |
| n8n to Convex, error | `workflow-error:<executionId>` | `webhookReceipts` | `200`, one `automationErrors` row only |

For reminders the key is validated against the loan id and date in the body, and the receipt insert, `lastReminderOn` patch, `reminderCount` increment and `reminder_sent` event are one transaction. `/n8n/overdue-loans` also filters out loans whose `lastReminderOn` equals the requested day, so a second run on the same day finds nothing to send even if receipts were lost.

## Request authentication

Both directions: `X-LendLoop-Signature: v1=hex(HMAC_SHA256(secret, timestamp + "." + rawBody))`, `X-LendLoop-Timestamp` in unix seconds, tolerance 300 seconds each way. The timestamp must be 1 to 12 digits. Direction secrets differ.

Convex side (`convex/http.ts`): reject on declared `Content-Length` over 64 KiB, read the stream with a running byte count and abort over the cap, verify the signature on the raw text, only then `JSON.parse`, then validate each field. Order of failure responses: 413, 401, 400.

n8n side (`Verify signature` node): reads the raw body (the webhook has `rawBody` enabled), applies the same timestamp window, compares with `timingSafeEqual` and rejects a missing `LENDLOOP_OUTBOUND_SECRET`. It also requires a string `eventId` and a non-blank recipient email (400 otherwise).

`scripts/sign-request.mjs` implements the same scheme for manual testing.

## Sequence: status notification

```mermaid
sequenceDiagram
  autonumber
  participant U as Owner (browser)
  participant C as Convex
  participant S as Scheduler / cron
  participant N as n8n webhook
  participant M as SMTP
  U->>C: mutation loans.approve
  Note over C: one transaction: patch loan, loanEvents row, outbox row (pending)
  C->>S: schedule deliver(outboxId)
  S->>C: deliver: claim (lease 60 s)
  S->>N: POST signed payload (30 s timeout)
  N->>N: verify timestamp and HMAC on raw body
  N->>N: eventId already processed?
  N->>M: send email (2 tries, 3 s wait)
  M-->>N: accepted
  N->>N: remember eventId
  N-->>S: 200 sent
  S->>C: markDelivered, notification_delivered event
```

Error path:

```mermaid
sequenceDiagram
  autonumber
  participant S as Convex deliver
  participant N as n8n
  participant M as SMTP
  participant C as Convex data
  participant E as n8n error handler
  S->>N: POST signed payload
  N->>M: send email
  M--xN: failure after retries
  N-->>S: 500 email failed
  S->>C: markFailed: attempts+1, nextAttemptAt = backoff, schedule retry
  Note over C: 30 s, 2 min, 10 min, 1 h, 6 h
  S->>N: retry (same eventId)
  N-->>S: 200 sent or duplicate
  S->>C: markDelivered
  Note over C: after 6 failed attempts: status dead, notification_failed event, visible in admin outbox with manual retry
  Note over N,E: if the workflow execution itself errors (for example a code node throws), n8n runs the error handler, which reports to Convex and emails the alert address
```

Responses from n8n to the webhook: 200 `sent`, 200 `duplicate`, 401 `unauthorized`, 400 `invalid payload`, 500 `email failed`. Only 200 marks a row delivered. A 400 or 401 is retried like any failure and ends up dead, which surfaces misconfiguration (wrong secret) in the admin outbox instead of hiding it.

## Sequence: overdue reminder with write-back

```mermaid
sequenceDiagram
  autonumber
  participant T as n8n schedule 09:00
  participant N as n8n workflow
  participant H as Convex /n8n routes
  participant D as Convex data
  participant M as SMTP
  T->>N: start run
  N->>N: asOf = today in GENERIC_TIMEZONE
  N->>H: POST /n8n/overdue-loans {asOf} (signed, 3 tries)
  H->>D: approved loans, endDate < asOf, lastReminderOn != asOf (page of 200)
  H-->>N: loans[], hasMore
  loop each loan, one at a time
    N->>M: send reminder (2 tries)
    alt sent
      N->>H: POST /n8n/reminder-sent {key, loanId, asOf} (signed, 3 tries)
      H->>D: one transaction: receipt, lastReminderOn, reminderCount+1, reminder_sent event
      H-->>N: recorded or duplicate
    else send or write-back failed
      N->>N: record loanId and error, continue with next loan
    end
  end
  alt hasMore and at least one loan succeeded and page < 10
    N->>H: fetch next page
  end
  alt any failure or loans still remaining
    N->>N: throw, error handler runs
  end
```

Failure handling:

- The write-back follows each send immediately, not at the end of the batch, so a later failure cannot cause already-sent borrowers to be emailed again on the next run of the same day.
- If the email is sent but the write-back fails after its retries, the loan is recorded as failed and left without a receipt. A rerun on the same day sends that borrower one more reminder. This is the accepted trade-off of at-least-once delivery.
- Paging only continues while a page produced at least one success. Otherwise the same failing loans would fill every page.
- Failures are accumulated and the run is failed at the end, which triggers the error workflow. One bad address never blocks the others.

## Error reporting

```mermaid
sequenceDiagram
  participant W as Failed workflow
  participant E as Error handler
  participant H as Convex /n8n/workflow-error
  participant A as Alert mailbox
  W->>E: error trigger with workflow, execution id, last node, message
  E->>H: signed POST, key workflow-error:<executionId>, message cut to 500 chars
  H-->>E: recorded or duplicate
  E->>A: email to LENDLOOP_ALERT_EMAIL
```

Both steps retry 3 times and continue on error, in that order: the Convex record is written first because it is the one admins can always see.

## Frontend notes

Pages: `/` (public catalog), `/tools/[id]`, `/tools/new`, `/tools/[id]/edit`, `/dashboard`, `/loans/[id]`, `/admin`, and the Clerk sign-in and sign-up routes. Data comes from Convex live queries, so request status, timeline entries and outbox state update without a refresh.
