import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { sign } from "./lib/signing";
import { daysFromNow, OUT_SECRET, setupWorld } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function pendingOutbox() {
  const w = await setupWorld();
  await w.borrower.mutation(api.loans.request, { toolId: w.toolId, startDate: daysFromNow(1), endDate: daysFromNow(2) });
  const row = (await w.t.run((ctx) => ctx.db.query("outbox").collect()))[0];
  return { ...w, row };
}

describe("deliver", () => {
  it("posts a signed minimized payload and marks it delivered", async () => {
    vi.stubEnv("N8N_LOAN_STATUS_WEBHOOK_URL", "http://n8n.test/hook");
    vi.stubEnv("LENDLOOP_OUTBOUND_SECRET", OUT_SECRET);
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, row } = await pendingOutbox();

    await t.action(internal.notifications.deliver, { outboxId: row._id });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://n8n.test/hook");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-LendLoop-Event-Id"]).toBe(row.eventId);
    const expected = await sign(OUT_SECRET, headers["X-LendLoop-Timestamp"], init.body as string);
    expect(headers["X-LendLoop-Signature"]).toBe(`v1=${expected}`);
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(["eventId", "link", "loan", "occurredAt", "recipient", "tool", "type"]);
    expect(Object.keys(body.recipient).sort()).toEqual(["email", "firstName"]);

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after?.status).toBe("delivered");
    const events = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(events.map((e) => e.type)).toContain("notification_delivered");
  });

  it("stays pending without a configured url", async () => {
    vi.stubEnv("N8N_LOAN_STATUS_WEBHOOK_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { t, row } = await pendingOutbox();
    await t.action(internal.notifications.deliver, { outboxId: row._id });
    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after).toMatchObject({ status: "pending", attempts: 0, lastError: "webhook url not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("backs off on failure and goes dead after six attempts", async () => {
    vi.stubEnv("N8N_LOAN_STATUS_WEBHOOK_URL", "http://n8n.test/hook");
    vi.stubEnv("LENDLOOP_OUTBOUND_SECRET", OUT_SECRET);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { t, row } = await pendingOutbox();
    const expectedDelays = [30, 120, 600, 3600, 21600];

    for (let i = 0; i < 5; i++) {
      await t.run((ctx) => ctx.db.patch(row._id, { nextAttemptAt: Date.now() }));
      const before = Date.now();
      await t.action(internal.notifications.deliver, { outboxId: row._id });
      const r = await t.run((ctx) => ctx.db.get(row._id));
      expect(r).toMatchObject({ status: "pending", attempts: i + 1, lastError: "http 500" });
      expect(r!.nextAttemptAt - before).toBeGreaterThanOrEqual(expectedDelays[i] * 1000);
      expect(r!.nextAttemptAt - before).toBeLessThan(expectedDelays[i] * 1000 + 1000);
    }
    await t.run((ctx) => ctx.db.patch(row._id, { nextAttemptAt: Date.now() }));
    await t.action(internal.notifications.deliver, { outboxId: row._id });
    const dead = await t.run((ctx) => ctx.db.get(row._id));
    expect(dead).toMatchObject({ status: "dead", attempts: 6 });
    const events = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(events.map((e) => e.type)).toContain("notification_failed");

    // a dead row is never retried automatically
    await t.action(internal.notifications.deliver, { outboxId: row._id });
    expect((await t.run((ctx) => ctx.db.get(row._id)))?.attempts).toBe(6);
  });

  it("records a network error as a failed attempt", async () => {
    vi.stubEnv("N8N_LOAN_STATUS_WEBHOOK_URL", "http://n8n.test/hook");
    vi.stubEnv("LENDLOOP_OUTBOUND_SECRET", OUT_SECRET);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const { t, row } = await pendingOutbox();
    await t.action(internal.notifications.deliver, { outboxId: row._id });
    expect(await t.run((ctx) => ctx.db.get(row._id))).toMatchObject({ attempts: 1, lastError: "network error" });
  });
});

describe("recovery and idempotence", () => {
  it("defers an unconfigured row without counting an attempt and the sweep retries it", async () => {
    const { t, row } = await pendingOutbox();
    await t.action(internal.notifications.deliver, { outboxId: row._id });
    const deferred = await t.run((ctx) => ctx.db.get(row._id));
    expect(deferred).toMatchObject({ status: "pending", attempts: 0, lastError: "webhook url not configured" });
    expect(deferred!.nextAttemptAt - Date.now()).toBeGreaterThan(9 * 60_000);

    expect(await t.mutation(internal.notifications.sweepPending, {})).toBe(0);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await t.mutation(internal.notifications.sweepPending, {})).toBe(1);
  });

  it("sweep picks up a stuck pending row and ignores delivered ones", async () => {
    const { t, row } = await pendingOutbox();
    await t.run((ctx) => ctx.db.patch(row._id, { nextAttemptAt: Date.now() - 1000 }));
    expect(await t.mutation(internal.notifications.sweepPending, {})).toBe(1);
    await t.run((ctx) => ctx.db.patch(row._id, { status: "delivered" }));
    expect(await t.mutation(internal.notifications.sweepPending, {})).toBe(0);
  });

  it("delivers a row once when deliver runs twice", async () => {
    vi.stubEnv("N8N_LOAN_STATUS_WEBHOOK_URL", "http://n8n.test/hook");
    vi.stubEnv("LENDLOOP_OUTBOUND_SECRET", OUT_SECRET);
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, row } = await pendingOutbox();
    await Promise.all([
      t.action(internal.notifications.deliver, { outboxId: row._id }),
      t.action(internal.notifications.deliver, { outboxId: row._id }),
    ]);
    await t.action(internal.notifications.deliver, { outboxId: row._id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await t.run((ctx) => ctx.db.get(row._id))).toMatchObject({ status: "delivered", attempts: 1 });
  });

  it("lets an admin retry a pending row", async () => {
    const { t, root, row } = await pendingOutbox();
    await t.run((ctx) => ctx.db.patch(row._id, { attempts: 2, nextAttemptAt: Date.now() + 99_000 }));
    await root.mutation(api.admin.retryDelivery, { outboxId: row._id });
    expect(await t.run((ctx) => ctx.db.get(row._id))).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("records a failed notification instead of queueing when the recipient has no email", async () => {
    const { t, borrower, as, owner, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, { toolId, startDate: daysFromNow(1), endDate: daysFromNow(2) });
    await t.run(async (ctx) => {
      for (const u of await ctx.db.query("users").collect()) if (u.name.startsWith("Ben")) await ctx.db.patch(u._id, { email: "" });
    });
    const before = (await t.run((ctx) => ctx.db.query("outbox").collect())).length;
    await owner.mutation(api.loans.approve, { loanId });
    expect((await t.run((ctx) => ctx.db.query("outbox").collect())).length).toBe(before);
    const events = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(events).toContainEqual(expect.objectContaining({ type: "notification_failed", detail: "recipient has no email address" }));
    void as;
  });
});
