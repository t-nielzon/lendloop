#!/usr/bin/env node
// signs a json body the same way the backend and n8n do and prints a ready curl command.
// usage: node scripts/sign-request.mjs <secret> <url> [json-body] [--timestamp <unix-seconds>]
import { createHmac } from "node:crypto";

export function sign(secret, timestamp, body) {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function main(argv) {
  const args = [];
  let timestamp = String(Math.floor(Date.now() / 1000));
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--timestamp") timestamp = argv[++i];
    else args.push(argv[i]);
  }
  const [secret, url, rawBody] = args;
  if (!secret || !url) {
    console.error("usage: node scripts/sign-request.mjs <secret> <url> [json-body] [--timestamp <unix-seconds>]");
    process.exit(1);
  }
  const body = rawBody ?? JSON.stringify({
    eventId: `evt-${Date.now()}`,
    type: "loan.status_changed",
    occurredAt: new Date().toISOString(),
    loan: { id: "demo-loan", status: "requested", previousStatus: null, startDate: "2026-11-10", endDate: "2026-11-12" },
    tool: { name: "Cordless drill" },
    recipient: { firstName: "Sam", email: "sam@example.com" },
    link: "http://localhost:3000/loans/demo-loan",
  });
  JSON.parse(body); // fail early on a malformed body
  let eventId = "";
  try { eventId = JSON.parse(body).eventId ?? JSON.parse(body).idempotencyKey ?? ""; } catch {}
  const lines = [
    `curl -i -X POST ${shellQuote(url)}`,
    `  -H 'Content-Type: application/json'`,
    `  -H ${shellQuote(`X-LendLoop-Event-Id: ${eventId}`)}`,
    `  -H ${shellQuote(`X-LendLoop-Timestamp: ${timestamp}`)}`,
    `  -H ${shellQuote(`X-LendLoop-Signature: ${sign(secret, timestamp, body)}`)}`,
    `  --data-raw ${shellQuote(body)}`,
  ];
  console.log(lines.join(" \\\n"));
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
