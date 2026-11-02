#!/bin/sh
# idempotent: fixed ids make the imports upsert, and activation can be repeated.
set -eu

n8n import:credentials --separate --input=/import/credentials
n8n import:workflow --separate --input=/import/workflows

# the error handler has no trigger to activate; the other two must be live for the webhook and schedule.
# newer n8n versions renamed the activation command, so try both.
for id in lendloopLoanStatus01 lendloopOverdue0001; do
  n8n publish:workflow --id="$id" 2>/dev/null || n8n update:workflow --id="$id" --active=true
done
