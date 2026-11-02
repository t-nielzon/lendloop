import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
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
    expect(statuses).toEqual(new Set(["requested", "approved", "declined", "cancelled", "returned"]));

    const approved = data.loans.filter((l) => l.status === "approved");
    for (const a of approved) {
      for (const b of approved) {
        if (a._id === b._id || a.toolId !== b.toolId) continue;
        expect(a.endDate < b.startDate || b.endDate < a.startDate).toBe(true);
      }
    }
    expect(approved.some((l) => l.reminderCount > 0 && l.lastReminderOn)).toBe(true);

    for (const loan of data.loans) {
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
});
