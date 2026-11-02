import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { isAutomationEvent } from "./lib/loanEvents";
import { setupWorld } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("demo seed", () => {
  it("is idempotent", async () => {
    const { t } = await setupWorld();
    const first = await t.mutation(internal.seed.demo, {});
    expect(first).toMatchObject({ seeded: true, users: 10 });
    const counts = async () =>
      t.run(async (ctx) => ({
        users: (await ctx.db.query("users").collect()).length,
        tools: (await ctx.db.query("tools").collect()).length,
        loans: (await ctx.db.query("loans").collect()).length,
      }));
    const before = await counts();
    expect(await t.mutation(internal.seed.demo, {})).toEqual({ seeded: false });
    expect(await counts()).toEqual(before);
  });

  it("resetDemo removes only seed data and reseeds", async () => {
    const { t, toolId } = await setupWorld();
    await t.mutation(internal.seed.demoTools, {});
    await t.mutation(internal.seed.demo, {});
    const res = await t.mutation(internal.seed.resetDemo, {});
    expect(res.removedUsers).toBe(11);
    const { realTool, seedUsers, tools } = await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      return {
        realTool: await ctx.db.get(toolId),
        seedUsers: users.filter((u) => u.tokenIdentifier.startsWith("seed|")),
        tools: await ctx.db.query("tools").collect(),
      };
    });
    expect(realTool?.name).toBe("Cordless drill");
    expect(seedUsers).toHaveLength(10);
    expect(seedUsers.every((u) => u.email.endsWith("@example.com") && u.role === "user")).toBe(true);
    expect(tools.length).toBe(res.tools + 1);
    expect(tools.filter((x) => x.status === "archived")).toHaveLength(2);
  });

  it("builds a consistent loan history without queueing deliveries", async () => {
    const { t } = await setupWorld();
    await t.mutation(internal.seed.demo, {});
    const now = Date.now();
    const data = await t.run(async (ctx) => ({
      loans: await ctx.db.query("loans").collect(),
      events: await ctx.db.query("loanEvents").collect(),
      outbox: await ctx.db.query("outbox").collect(),
    }));
    expect(data.outbox).toHaveLength(0);
    const statuses = new Set(data.loans.map((l) => l.status));
    expect(statuses).toEqual(new Set(["requested", "approved", "declined", "cancelled", "returned", "expired"]));

    const approved = data.loans.filter((l) => l.status === "approved");
    for (const a of approved) {
      for (const b of approved) {
        if (a._id === b._id || a.toolId !== b.toolId) continue;
        expect(a.endDate < b.startDate || b.endDate < a.startDate).toBe(true);
      }
    }
    expect(approved.some((l) => l.reminderCount > 0 && l.lastReminderOn)).toBe(true);

    expect(data.loans.filter((l) => l.status === "expired")).toHaveLength(1);
    const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
    expect(approved.some((l) => l.startDate === tomorrow && !l.pickupReminderOn)).toBe(true);
    const stale = data.loans.filter((l) => l.status === "requested" && l.createdAt <= now - 48 * 3_600_000 && !l.nudgedAt);
    expect(stale.length).toBeGreaterThan(0);

    for (const loan of data.loans) {
      const automation = data.events.filter((e) => e.loanId === loan._id && isAutomationEvent(e.type)).sort((x, y) => x.at - y.at);
      expect(loan.lastAutomationAt).toBe(automation.at(-1)?.at);
      expect(loan.lastAutomationType).toBe(automation.at(-1)?.type);
      const events = data.events.filter((e) => e.loanId === loan._id).sort((x, y) => x._creationTime - y._creationTime);
      expect(events[0].type).toBe("requested");
      expect(events[0].actorId).toBe(loan.borrowerId);
      for (let i = 1; i < events.length; i++) expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
      expect(events.every((e) => e.at <= now)).toBe(true);
      if (loan.status !== "requested" && loan.status !== "approved") {
        expect(events.some((e) => e.type === loan.status)).toBe(true);
      }
    }
  });

  it("dev helpers age a requested loan and manage a removable dead outbox row", async () => {
    const { t } = await setupWorld();
    await t.mutation(internal.seed.demo, {});
    const loan = await t.run(async (ctx) => (await ctx.db.query("loans").collect()).find((l) => l.status === "requested")!);
    await t.mutation(internal.seed.ageRequest, { loanId: loan._id, hoursOld: 72, startDate: "2026-01-01" });
    const aged = await t.run((ctx) => ctx.db.get(loan._id));
    expect(aged?.startDate).toBe("2026-01-01");
    expect(Math.abs(Date.now() - aged!.createdAt - 72 * 3_600_000)).toBeLessThan(1000);
    await expect(t.mutation(internal.seed.ageRequest, { loanId: loan._id, hoursOld: 1, startDate: "soon" })).rejects.toThrow();

    await t.mutation(internal.seed.createDevIncident, { loanId: loan._id });
    expect((await t.query(internal.automation.deliveryHealth, {})).dead).toBe(1);
    expect(await t.mutation(internal.seed.clearDevIncidents, {})).toEqual({ removed: 1 });
    expect((await t.query(internal.automation.deliveryHealth, {})).dead).toBe(0);
  });
});
