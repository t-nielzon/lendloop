import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { signatureHeader } from "./lib/signing";
import { daysFromNow, IN_SECRET, setupWorld } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("LENDLOOP_INBOUND_SECRET", IN_SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type World = Awaited<ReturnType<typeof setupWorld>>;

async function post(w: World, path: string, payload: unknown, opts: { secret?: string; ts?: number; raw?: string } = {}) {
  const body = opts.raw ?? JSON.stringify(payload);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  return await w.t.fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": ts,
      "X-LendLoop-Signature": await signatureHeader(opts.secret ?? IN_SECRET, ts, body),
    },
    body,
  });
}

async function approvedOverdueLoan() {
  const w = await setupWorld();
  const loanId = await w.borrower.mutation(api.loans.request, { toolId: w.toolId, startDate: daysFromNow(0), endDate: daysFromNow(1) });
  await w.owner.mutation(api.loans.approve, { loanId });
  await w.t.run((ctx) => ctx.db.patch(loanId, { startDate: daysFromNow(-5), endDate: daysFromNow(-2) }));
  return { ...w, loanId, asOf: daysFromNow(0) };
}

describe("signature gate", () => {
  it("rejects bad signatures, wrong secrets and stale timestamps with 401", async () => {
    const w = await setupWorld();
    const asOf = daysFromNow(0);
    expect((await post(w, "/n8n/overdue-loans", { asOf }, { secret: "wrong" })).status).toBe(401);
    expect((await post(w, "/n8n/overdue-loans", { asOf }, { ts: Math.floor(Date.now() / 1000) - 400 })).status).toBe(401);
    const unsigned = await w.t.fetch("/n8n/overdue-loans", { method: "POST", body: JSON.stringify({ asOf }) });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a tampered body", async () => {
    const w = await setupWorld();
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await signatureHeader(IN_SECRET, ts, JSON.stringify({ asOf: "2026-01-01" }));
    const res = await w.t.fetch("/n8n/overdue-loans", {
      method: "POST",
      headers: { "X-LendLoop-Timestamp": ts, "X-LendLoop-Signature": signature },
      body: JSON.stringify({ asOf: "2026-01-02" }),
    });
    expect(res.status).toBe(401);
  });

  it("fails closed when the inbound secret is not configured", async () => {
    vi.stubEnv("LENDLOOP_INBOUND_SECRET", "");
    const w = await setupWorld();
    expect((await post(w, "/n8n/overdue-loans", { asOf: daysFromNow(0) })).status).toBe(401);
  });

  it("rejects oversized and malformed signed bodies", async () => {
    const w = await setupWorld();
    expect((await post(w, "/n8n/workflow-error", null, { raw: JSON.stringify({ message: "x".repeat(70_000) }) })).status).toBe(413);
    expect((await post(w, "/n8n/overdue-loans", null, { raw: "not json" })).status).toBe(400);
    expect((await post(w, "/n8n/overdue-loans", { asOf: "tomorrow" })).status).toBe(400);
  });
});

describe("/n8n/overdue-loans", () => {
  it("returns approved loans past their end date with minimal fields", async () => {
    const w = await approvedOverdueLoan();
    const res = await post(w, "/n8n/overdue-loans", { asOf: w.asOf });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asOf: w.asOf,
      hasMore: false,
      loans: [
        {
          loanId: w.loanId,
          toolName: "Cordless drill",
          borrowerFirstName: "Ben",
          borrowerEmail: "ben@example.com",
          endDate: daysFromNow(-2),
          daysOverdue: 2,
        },
      ],
    });
  });

  it("excludes loans already reminded for that day", async () => {
    const w = await approvedOverdueLoan();
    await post(w, "/n8n/reminder-sent", { idempotencyKey: `overdue-reminder:${w.loanId}:${w.asOf}`, loanId: w.loanId, asOf: w.asOf });
    const res = await post(w, "/n8n/overdue-loans", { asOf: w.asOf });
    expect((await res.json()).loans).toEqual([]);
  });
});

describe("overdue paging", () => {
  it("skips already-reminded loans before applying the limit and reports hasMore", async () => {
    const w = await approvedOverdueLoan();
    const ids = await w.t.run(async (ctx) => {
      const base = (await ctx.db.get(w.loanId))!;
      const { _id, _creationTime, ...rest } = base;
      void _id;
      void _creationTime;
      const out = [];
      // earlier end dates sort first, so these reminded loans would fill a naive limit
      for (let i = 0; i < 3; i++) out.push(await ctx.db.insert("loans", { ...rest, endDate: daysFromNow(-30 - i), lastReminderOn: w.asOf }));
      for (let i = 0; i < 2; i++) out.push(await ctx.db.insert("loans", { ...rest, endDate: daysFromNow(-10 - i) }));
      return out;
    });
    expect(ids).toHaveLength(5);
    const page = await w.t.query(internal.automation.overdueLoans, { asOf: w.asOf, limit: 2 });
    expect(page.loans).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const all = await w.t.query(internal.automation.overdueLoans, { asOf: w.asOf, limit: 10 });
    expect(all.loans).toHaveLength(3);
    expect(all.hasMore).toBe(false);
  });
});

describe("body size", () => {
  it("rejects a chunked body over the cap even without a content-length", async () => {
    const w = await setupWorld();
    const chunk = new TextEncoder().encode("x".repeat(40_000));
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.close();
      },
    });
    const res = await w.t.fetch("/n8n/overdue-loans", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
  });
});

describe("/n8n/reminder-sent", () => {
  it("records once and treats a repeat key as a no-op", async () => {
    const w = await approvedOverdueLoan();
    const payload = { idempotencyKey: `overdue-reminder:${w.loanId}:${w.asOf}`, loanId: w.loanId, asOf: w.asOf };
    const first = await post(w, "/n8n/reminder-sent", payload);
    expect(await first.json()).toEqual({ status: "recorded" });
    const second = await post(w, "/n8n/reminder-sent", payload);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "duplicate" });

    const loan = await w.t.run((ctx) => ctx.db.get(w.loanId));
    expect(loan).toMatchObject({ reminderCount: 1, lastReminderOn: w.asOf });
    const events = await w.t.run((ctx) => ctx.db.query("loanEvents").collect());
    const reminders = events.filter((e) => e.type === "reminder_sent");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].actorType).toBe("automation");
    expect(await w.t.run((ctx) => ctx.db.query("webhookReceipts").collect())).toHaveLength(1);
  });

  it("rejects mismatched keys, unknown loans and bad shapes with 400", async () => {
    const w = await approvedOverdueLoan();
    const mismatch = { idempotencyKey: `overdue-reminder:${w.loanId}:2020-01-01`, loanId: w.loanId, asOf: w.asOf };
    expect((await post(w, "/n8n/reminder-sent", mismatch)).status).toBe(400);
    expect((await post(w, "/n8n/reminder-sent", { idempotencyKey: "overdue-reminder:nope:" + w.asOf, loanId: "nope", asOf: w.asOf })).status).toBe(400);
    expect((await post(w, "/n8n/reminder-sent", { loanId: w.loanId })).status).toBe(400);
    expect(await w.t.run((ctx) => ctx.db.query("webhookReceipts").collect())).toHaveLength(0);
  });
});

describe("/n8n/workflow-error", () => {
  it("stores one row per idempotency key", async () => {
    const w = await setupWorld();
    const payload = { idempotencyKey: "err-1", workflowName: "LendLoop - Loan status notification", nodeName: "Send Email", executionId: "42", message: "smtp refused" };
    expect((await post(w, "/n8n/workflow-error", payload)).status).toBe(200);
    expect((await post(w, "/n8n/workflow-error", payload)).status).toBe(200);
    const rows = await w.root.query(api.admin.automationErrors, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workflowName: payload.workflowName, message: "smtp refused" });
  });

  it("validates shape and truncates long messages", async () => {
    const w = await setupWorld();
    expect((await post(w, "/n8n/workflow-error", { idempotencyKey: "e2" })).status).toBe(400);
    await post(w, "/n8n/workflow-error", { idempotencyKey: "e3", workflowName: "wf", message: "m".repeat(2000) });
    const rows = await w.root.query(api.admin.automationErrors, {});
    expect(rows[0].message).toHaveLength(500);
  });
});
