#!/bin/sh
# idempotent: fixed ids make the imports upsert, and activation can be repeated.
set -eu

n8n import:credentials --separate --input=/import/credentials
n8n import:workflow --separate --input=/import/workflows

# all six must be published: the webhook and schedule need to be live, and n8n refuses to run an error workflow that is not published.
# newer n8n versions renamed the activation command, so try both.
for id in lendloopErrHandler1 lendloopLoanStatus01 lendloopOverdue0001 lendloopPickup00001 lendloopStale000001 lendloopHealth00001; do
  n8n publish:workflow --id="$id" 2>/dev/null || n8n update:workflow --id="$id" --active=true
done
