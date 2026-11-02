import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isAutomationEvent } from "./lib/loanEvents";
import { signatureHeader } from "./lib/signing";
import { daysFromNow, IN_SECRET, setupWorld } from "./test.helpers";

const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("LENDLOOP_INBOUND_SECRET", IN_SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type World = Awaited<ReturnType<typeof setupWorld>>;

async function post(w: World, path: string, payload: unknown, secret = IN_SECRET) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  return await w.t.fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": ts,
      "X-LendLoop-Signature": await signatureHeader(secret, ts, body),
    },
    body,
  });
}

async function requestedLoan(w: World, start = 3, end = 4) {
  return await w.borrower.mutation(api.loans.request, { toolId: w.toolId, startDate: daysFromNow(start), endDate: daysFromNow(end) });
}

async function approvedLoan(w: World, start = 1, end = 2) {
  const loanId = await requestedLoan(w, start, end);
  await w.owner.mutation(api.loans.approve, { loanId });
  return loanId;
}

const events = (w: World, loanId: Id<"loans">) =>
  w.t.run((ctx) => ctx.db.query("loanEvents").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect());

describe("inbound secret rotation", () => {
  it("accepts the previous secret and rejects unknown ones", async () => {
    const w = await setupWorld();
    vi.stubEnv("LENDLOOP_INBOUND_SECRET_PREVIOUS", "old-secret");
    expect((await post(w, "/n8n/delivery-health", {}, "old-secret")).status).toBe(200);
    expect((await post(w, "/n8n/delivery-health", {}, IN_SECRET)).status).toBe(200);
    expect((await post(w, "/n8n/delivery-health", {}, "unknown")).status).toBe(401);
  });

  it("ignores an unset or empty previous secret", async () => {
    const w = await setupWorld();
    vi.stubEnv("LENDLOOP_INBOUND_SECRET_PREVIOUS", "");
    expect((await post(w, "/n8n/delivery-health", {}, "x")).status).toBe(401);
    vi.stubEnv("LENDLOOP_INBOUND_SECRET", "");
    expect((await post(w, "/n8n/delivery-health", {}, IN_SECRET)).status).toBe(401);
  });
});

describe("new routes require a signature", () => {
  it.each([
    "/n8n/upcoming-pickups",
    "/n8n/pickup-reminder-sent",
    "/n8n/stale-requests",
    "/n8n/request-nudged",
    "/n8n/expire-request",
    "/n8n/delivery-health",
    "/n8n/health-alert-sent",
  ])("%s returns 401 when unsigned", async (path) => {
    const w = await setupWorld();
    const res = await w.t.fetch(path, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});

describe("upcoming pickups", () => {
  it("lists approved loans starting tomorrow and records the reminder once", async () => {
    const w = await setupWorld();
    const loanId = await approvedLoan(w);
    const asOf = daysFromNow(0);
    const res = await (await post(w, "/n8n/upcoming-pickups", { asOf })).json();
    expect(res.loans).toHaveLength(1);
    expect(res.loans[0]).toMatchObject({ loanId, toolName: "Cordless drill", borrowerEmail: "ben@example.com", ownerEmail: "olive@example.com" });
    expect(res.hasMore).toBe(false);

    const key = `pickup-reminder:${loanId}:${asOf}`;
    const body = { idempotencyKey: key, loanId, asOf };
    expect(await (await post(w, "/n8n/pickup-reminder-sent", body)).json()).toEqual({ status: "recorded" });
    expect(await (await post(w, "/n8n/pickup-reminder-sent", body)).json()).toEqual({ status: "duplicate" });
    expect((await events(w, loanId)).filter((e) => e.type === "pickup_reminder_sent")).toHaveLength(1);
    expect((await (await post(w, "/n8n/upcoming-pickups", { asOf })).json()).loans).toHaveLength(0);
    expect((await post(w, "/n8n/pickup-reminder-sent", { ...body, idempotencyKey: "nope" })).status).toBe(400);
  });

  it("filters before the limit so reminded loans do not hide later ones", async () => {
    const w = await setupWorld();
    const first = await approvedLoan(w);
    const asOf = daysFromNow(0);
    await w.t.mutation(internal.automation.recordPickupReminder, { idempotencyKey: `pickup-reminder:${first}:${asOf}`, loanId: first, asOf });
    const second = await w.borrower.mutation(api.loans.request, {
      toolId: await w.owner.mutation(api.tools.create, { name: "Saw", description: "hand saw", category: "hand-tools", condition: "good" }),
      startDate: daysFromNow(1),
      endDate: daysFromNow(2),
    });
    await w.owner.mutation(api.loans.approve, { loanId: second });
    const page = await w.t.query(internal.automation.upcomingPickups, { asOf, limit: 1 });
    expect(page.loans.map((l) => l.loanId)).toEqual([second]);
    expect(page.hasMore).toBe(false);
    await w.t.mutation(internal.automation.recordPickupReminder, { idempotencyKey: `pickup-reminder:${second}:${asOf}`, loanId: second, asOf });
  });

  it("reports hasMore when more than the limit remain", async () => {
    const w = await setupWorld();
    await approvedLoan(w);
    const tool2 = await w.owner.mutation(api.tools.create, { name: "Saw", description: "hand saw", category: "hand-tools", condition: "good" });
    const l2 = await w.borrower.mutation(api.loans.request, { toolId: tool2, startDate: daysFromNow(1), endDate: daysFromNow(2) });
    await w.owner.mutation(api.loans.approve, { loanId: l2 });
    const page = await w.t.query(internal.automation.upcomingPickups, { asOf: daysFromNow(0), limit: 1 });
    expect(page.loans).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });
});

describe("stale requests", () => {
  it("separates nudge and expire candidates and honours nudgedAt", async () => {
    const w = await setupWorld();
    const old = await requestedLoan(w, 3, 4);
    const asOf = daysFromNow(0);
    expect((await (await post(w, "/n8n/stale-requests", { asOf })).json()).toNudge).toHaveLength(0);

    vi.setSystemTime(Date.now() + 49 * HOUR);
    const later = daysFromNow(0);
    const res = await (await post(w, "/n8n/stale-requests", { asOf: later })).json();
    expect(res.toNudge).toHaveLength(1);
    expect(res.toNudge[0]).toMatchObject({ loanId: old, ownerEmail: "olive@example.com", });
    expect(res.toNudge[0].ageHours).toBeGreaterThanOrEqual(48);
    expect(res.toExpire).toHaveLength(0);

    const body = { idempotencyKey: `request-nudge:${old}`, loanId: old };
    expect(await (await post(w, "/n8n/request-nudged", body)).json()).toEqual({ status: "recorded" });
    expect(await (await post(w, "/n8n/request-nudged", body)).json()).toEqual({ status: "duplicate" });
    expect((await (await post(w, "/n8n/stale-requests", { asOf: later })).json()).toNudge).toHaveLength(0);

    const expiredAsOf = daysFromNow(10);
    const res2 = await (await post(w, "/n8n/stale-requests", { asOf: expiredAsOf })).json();
    expect(res2.toExpire.map((x: { loanId: string }) => x.loanId)).toEqual([old]);
  });

  it("filters before the limit and reports hasMore", async () => {
    const w = await setupWorld();
    const a = await requestedLoan(w, 3, 4);
    const tool2 = await w.owner.mutation(api.tools.create, { name: "Saw", description: "hand saw", category: "hand-tools", condition: "good" });
    const b = await w.borrower.mutation(api.loans.request, { toolId: tool2, startDate: daysFromNow(3), endDate: daysFromNow(4) });
    vi.setSystemTime(Date.now() + 49 * HOUR);
    const asOf = daysFromNow(0);
    // a is already nudged, so the one-row page must skip it and still reach b
    await w.t.mutation(internal.automation.recordNudge, { idempotencyKey: `request-nudge:${a}`, loanId: a });
    const page = await w.t.query(internal.automation.staleRequests, { asOf, limit: 1 });
    expect(page.toNudge.map((x) => x.loanId)).toEqual([b]);
    expect(page.hasMore).toBe(false);
    await w.t.mutation(internal.automation.recordNudge, { idempotencyKey: `request-nudge:${b}`, loanId: b });
    expect((await w.t.query(internal.automation.staleRequests, { asOf, limit: 1 })).toNudge).toHaveLength(0);
  });

  it("reports hasMore when more than the limit qualify", async () => {
    const w = await setupWorld();
    await requestedLoan(w, 3, 4);
    const tool2 = await w.owner.mutation(api.tools.create, { name: "Saw", description: "hand saw", category: "hand-tools", condition: "good" });
    await w.borrower.mutation(api.loans.request, { toolId: tool2, startDate: daysFromNow(3), endDate: daysFromNow(4) });
    vi.setSystemTime(Date.now() + 49 * HOUR);
    const page = await w.t.query(internal.automation.staleRequests, { asOf: daysFromNow(0), limit: 1 });
    expect(page.toNudge).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });
});

describe("expire request", () => {
  async function pastStartLoan(w: World) {
    const loanId = await requestedLoan(w, 3, 4);
    await w.t.run((ctx) => ctx.db.patch(loanId, { startDate: daysFromNow(-2), endDate: daysFromNow(-1) }));
    return loanId;
  }

  it("expires, notifies the borrower through the outbox and is idempotent", async () => {
    const w = await setupWorld();
    const loanId = await pastStartLoan(w);
    const body = { idempotencyKey: `request-expire:${loanId}`, loanId, asOf: daysFromNow(0) };
    expect(await (await post(w, "/n8n/expire-request", body)).json()).toEqual({ status: "recorded" });
    expect(await (await post(w, "/n8n/expire-request", body)).json()).toEqual({ status: "duplicate" });

    const { loan, outbox } = await w.t.run(async (ctx) => ({
      loan: await ctx.db.get(loanId),
      outbox: await ctx.db.query("outbox").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect(),
    }));
    expect(loan?.status).toBe("expired");
    const row = outbox.find((o) => (o.payload as { loan: { status: string } }).loan.status === "expired");
    expect(row?.payload).toMatchObject({
      type: "loan.status_changed",
      loan: { status: "expired", previousStatus: "requested" },
      recipient: { email: "ben@example.com" },
    });
    const ev = (await events(w, loanId)).find((e) => e.type === "expired");
    expect(ev).toMatchObject({ actorType: "automation" });
    expect(loan).toMatchObject({ lastAutomationType: "expired", lastAutomationAt: ev?.at });
  });

  it("is skipped when the owner decided meanwhile or the start has not passed", async () => {
    const w = await setupWorld();
    const decided = await pastStartLoan(w);
    await w.t.run((ctx) => ctx.db.patch(decided, { status: "declined" }));
    expect(await (await post(w, "/n8n/expire-request", { idempotencyKey: `request-expire:${decided}`, loanId: decided, asOf: daysFromNow(0) })).json()).toEqual({ status: "skipped" });
    const future = await w.borrower.mutation(api.loans.request, { toolId: w.toolId, startDate: daysFromNow(5), endDate: daysFromNow(6) });
    expect(await (await post(w, "/n8n/expire-request", { idempotencyKey: `request-expire:${future}`, loanId: future, asOf: daysFromNow(0) })).json()).toEqual({ status: "skipped" });
    expect((await w.t.run((ctx) => ctx.db.get(future)))?.status).toBe("requested");
  });

  it("compares against the supplied date and rejects a missing or far-off one", async () => {
    const w = await setupWorld();
    const loanId = await pastStartLoan(w);
    const base = { idempotencyKey: `request-expire:${loanId}`, loanId };
    expect((await post(w, "/n8n/expire-request", base)).status).toBe(400);
    expect((await post(w, "/n8n/expire-request", { ...base, asOf: "nope" })).status).toBe(400);
    expect((await post(w, "/n8n/expire-request", { ...base, asOf: daysFromNow(2) })).status).toBe(400);
    expect((await post(w, "/n8n/expire-request", { ...base, asOf: daysFromNow(-2) })).status).toBe(400);
    expect((await w.t.run((ctx) => ctx.db.get(loanId)))?.status).toBe("requested");
    // a start date equal to the supplied date has not passed yet
    await w.t.run((ctx) => ctx.db.patch(loanId, { startDate: daysFromNow(1) }));
    expect(await (await post(w, "/n8n/expire-request", { ...base, asOf: daysFromNow(1) })).json()).toEqual({ status: "skipped" });
    expect(await (await post(w, "/n8n/expire-request", { ...base, asOf: daysFromNow(1) })).json()).toEqual({ status: "skipped" });
  });

  it("cannot be triggered by users and expired loans cannot move on", async () => {
    const w = await setupWorld();
    const loanId = await pastStartLoan(w);
    await w.t.mutation(internal.automation.expireRequest, { idempotencyKey: `request-expire:${loanId}`, loanId, asOf: daysFromNow(0) });
    for (const [who, fn] of [
      [w.owner, api.loans.approve],
      [w.owner, api.loans.decline],
      [w.borrower, api.loans.cancel],
      [w.owner, api.loans.markReturned],
    ] as const) {
      await expect(who.mutation(fn, { loanId })).rejects.toThrow(/expired/);
    }
    expect(Object.keys(api.loans)).not.toContain("expire");
  });
});

describe("delivery health", () => {
  async function addOutbox(w: World, status: "pending" | "dead", createdAt: number, loanId: Id<"loans">) {
    return await w.t.run((ctx) =>
      ctx.db.insert("outbox", { eventId: crypto.randomUUID(), loanId, payload: {}, status, attempts: 0, nextAttemptAt: createdAt, createdAt }),
    );
  }

  it("keys the incident on its oldest problem row and ends it on recovery", async () => {
    const w = await setupWorld();
    const loanId = await requestedLoan(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const health = async () => await (await post(w, "/n8n/delivery-health", {})).json();
    const healthy = await health();
    expect(healthy).toMatchObject({ dead: 0, stuckPending: 0, incidentKey: null, alreadyAlerted: false, countCapped: false });
    expect(typeof healthy.checkedAt).toBe("string");

    const oldest = await addOutbox(w, "pending", Date.now() - 45 * HOUR / 60, loanId);
    await addOutbox(w, "pending", Date.now(), loanId);
    const a = await health();
    expect(a).toMatchObject({ dead: 0, stuckPending: 1 });
    expect(a.incidentKey).toMatch(/^[0-9a-f]{16}$/);
    expect(a.oldestStuckAt).toBe((await w.t.run((ctx) => ctx.db.get(oldest)))?.createdAt);

    await addOutbox(w, "dead", Date.now(), loanId);
    await addOutbox(w, "pending", Date.now() - 35 * HOUR / 60, loanId);
    const b = await health();
    expect(b).toMatchObject({ dead: 1, stuckPending: 2 });
    expect(b.incidentKey).toBe(a.incidentKey);

    await w.t.run(async (ctx) => {
      for (const r of await ctx.db.query("outbox").collect()) await ctx.db.delete(r._id);
    });
    expect((await health()).incidentKey).toBeNull();
    await addOutbox(w, "dead", Date.now(), loanId);
    const c = await health();
    expect(c.incidentKey).toMatch(/^[0-9a-f]{16}$/);
    expect(c.incidentKey).not.toBe(a.incidentKey);
  });

  it("reports whether the incident was already alerted", async () => {
    const w = await setupWorld();
    const loanId = await requestedLoan(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    await addOutbox(w, "dead", Date.now(), loanId);
    const first = await (await post(w, "/n8n/delivery-health", {})).json();
    expect(first.alreadyAlerted).toBe(false);
    const key = first.incidentKey;
    await post(w, "/n8n/health-alert-sent", { idempotencyKey: `health-alert:${key}`, incidentKey: key, dead: 1, stuckPending: 0 });
    await addOutbox(w, "dead", Date.now(), loanId);
    expect(await (await post(w, "/n8n/delivery-health", {})).json()).toMatchObject({ incidentKey: key, alreadyAlerted: true });
  });

  it("caps counts and flags it", async () => {
    const w = await setupWorld();
    const loanId = await requestedLoan(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    await w.t.run(async (ctx) => {
      const at = Date.now();
      for (let i = 0; i < 1001; i++) {
        await ctx.db.insert("outbox", { eventId: `e${i}`, loanId, payload: {}, status: "dead", attempts: 0, nextAttemptAt: at, createdAt: at });
      }
    });
    expect(await (await post(w, "/n8n/delivery-health", {})).json()).toMatchObject({ dead: 1000, countCapped: true });
  });

  it("records a health alert once per incident and lists it for admins", async () => {
    const w = await setupWorld();
    const body = { idempotencyKey: "health-alert:abc123", incidentKey: "abc123", dead: 2, stuckPending: 1, oldestStuckAt: 1000 };
    expect(await (await post(w, "/n8n/health-alert-sent", body)).json()).toEqual({ status: "recorded" });
    expect(await (await post(w, "/n8n/health-alert-sent", body)).json()).toEqual({ status: "duplicate" });
    expect((await post(w, "/n8n/health-alert-sent", { ...body, idempotencyKey: "other" })).status).toBe(400);
    const rows = await w.root.query(api.admin.healthAlerts, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ incidentKey: "abc123", dead: 2, stuckPending: 1, oldestStuckAt: 1000 });
    await expect(w.owner.query(api.admin.healthAlerts, {})).rejects.toThrow();
  });
});

describe("last automation", () => {
  it("is updated by every automation event type and exposed on loan views", async () => {
    const w = await setupWorld();
    const loanId = await approvedLoan(w);
    const asOf = daysFromNow(0);
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["notification_delivered", async () => {
        await w.t.finishAllScheduledFunctions(vi.runAllTimers);
        const row = (await w.t.run((ctx) => ctx.db.query("outbox").collect()))[0];
        await w.t.mutation(internal.notifications.markDelivered, { outboxId: row._id });
      }],
      ["notification_failed", async () => {
        const row = (await w.t.run((ctx) => ctx.db.query("outbox").collect()))[0];
        await w.t.run((ctx) => ctx.db.patch(row._id, { status: "pending", attempts: 5 }));
        await w.t.mutation(internal.notifications.markFailed, { outboxId: row._id, error: "boom" });
      }],
      ["pickup_reminder_sent", () => w.t.mutation(internal.automation.recordPickupReminder, { idempotencyKey: `pickup-reminder:${loanId}:${asOf}`, loanId, asOf })],
      ["reminder_sent", () => w.t.mutation(internal.automation.recordReminder, { idempotencyKey: `overdue-reminder:${loanId}:${asOf}`, loanId, asOf })],
    ];
    for (const [type, run] of steps) {
      vi.advanceTimersByTime(1000);
      await run();
      const loan = await w.t.run((ctx) => ctx.db.get(loanId));
      expect(loan?.lastAutomationType).toBe(type);
      const latest = (await events(w, loanId)).filter((e) => isAutomationEvent(e.type)).at(-1);
      expect(loan?.lastAutomationAt).toBe(latest?.at);
    }
    const mine = await w.borrower.query(api.loans.listMyRequests, {});
    expect(mine[0].lastAutomation).toMatchObject({ type: "reminder_sent" });
    expect((await w.owner.query(api.loans.listIncoming, {}))[0].lastAutomation).not.toBeNull();
    expect((await w.root.query(api.loans.listAll, {}))[0].lastAutomation).not.toBeNull();
    expect((await w.borrower.query(api.loans.get, { loanId }))?.lastAutomation).toMatchObject({ type: "reminder_sent" });
  });

  it("skips a nudge for a loan that is no longer requested without writing", async () => {
    const w = await setupWorld();
    const loanId = await requestedLoan(w);
    await w.t.run((ctx) => ctx.db.patch(loanId, { status: "declined" }));
    const before = (await events(w, loanId)).length;
    const res = await (await post(w, "/n8n/request-nudged", { idempotencyKey: `request-nudge:${loanId}`, loanId })).json();
    expect(res).toEqual({ status: "skipped" });
    expect((await events(w, loanId)).length).toBe(before);
    const loan = await w.t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.nudgedAt).toBeUndefined();
    const receipts = await w.t.run((ctx) => ctx.db.query("webhookReceipts").collect());
    expect(receipts.some((r) => r.idempotencyKey === `request-nudge:${loanId}`)).toBe(false);
  });

  it("covers nudge and null for loans without automation", async () => {
    const w = await setupWorld();
    const loanId = await requestedLoan(w);
    await w.t.mutation(internal.automation.recordNudge, { idempotencyKey: `request-nudge:${loanId}`, loanId });
    expect((await w.borrower.query(api.loans.get, { loanId }))?.lastAutomation).toMatchObject({ type: "request_nudged" });
    const other = await w.borrower.mutation(api.loans.request, { toolId: w.toolId, startDate: daysFromNow(10), endDate: daysFromNow(11) });
    expect((await w.borrower.query(api.loans.get, { loanId: other }))?.lastAutomation).toBeNull();
  });
});
