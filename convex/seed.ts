import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { invalid } from "./lib/errors";

// dev-only helpers: internal functions are unreachable from clients, so they can only be run through the cli

const DEMO_OWNER_TOKEN = "seed|demo-owner";

const DEMO_TOOLS = [
  { name: "Cordless drill", description: "18v with two batteries and a case", category: "power-tools", condition: "good" },
  { name: "Extension ladder", description: "Aluminium, extends to 4 m", category: "hand-tools", condition: "worn" },
  { name: "Hedge trimmer", description: "Electric, 55 cm blade", category: "garden", condition: "good" },
  { name: "Stand mixer", description: "5 litre bowl with dough hook", category: "kitchen", condition: "new" },
  { name: "Two-person tent", description: "Three season, easy pitch", category: "outdoor", condition: "good" },
] as const;

export const demoTools = internalMutation({
  args: {},
  handler: async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", DEMO_OWNER_TOKEN))
      .unique();
    const now = Date.now();
    const ownerId =
      owner?._id ??
      (await ctx.db.insert("users", {
        tokenIdentifier: DEMO_OWNER_TOKEN,
        name: "Demo Neighbour",
        email: "demo-neighbour@example.com",
        role: "user",
        createdAt: now,
      }));

    const existing = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(100);
    const have = new Set(existing.map((t) => t.name));
    let created = 0;
    for (const t of DEMO_TOOLS) {
      if (have.has(t.name)) continue;
      await ctx.db.insert("tools", { ...t, ownerId, status: "active", createdAt: now, updatedAt: now });
      created++;
    }
    return { created };
  },
});

// pushes an approved loan into the past so the overdue reminder flow can be exercised
export const backdateLoan = internalMutation({
  args: { loanId: v.id("loans"), endDate: v.string() },
  handler: async (ctx, { loanId, endDate }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) throw invalid("loan not found");
    if (loan.status !== "approved") throw invalid("only approved loans can be backdated");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw invalid("endDate must be YYYY-MM-DD");
    const startDate = loan.startDate > endDate ? endDate : loan.startDate;
    await ctx.db.patch(loanId, { startDate, endDate, lastReminderOn: undefined, updatedAt: Date.now() });
    return null;
  },
});
