import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { invalid } from "./lib/errors";

// payload is summarised rather than returned so recipient emails stay out of the admin ui
export const outbox = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = [
      ...(await ctx.db.query("outbox").withIndex("by_status", (q) => q.eq("status", "dead")).order("desc").take(100)),
      ...(await ctx.db.query("outbox").withIndex("by_status", (q) => q.eq("status", "pending")).order("desc").take(100)),
    ];
    return rows.map((r) => ({
      id: r._id,
      eventId: r.eventId,
      loanId: r.loanId,
      status: r.status,
      attempts: r.attempts,
      nextAttemptAt: r.nextAttemptAt,
      lastError: r.lastError,
      createdAt: r.createdAt,
      loanStatus: (r.payload as { loan?: { status?: string } })?.loan?.status,
    }));
  },
});

export const retryDelivery = mutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.outboxId);
    if (!row) throw invalid("delivery not found");
    if (row.status === "delivered") throw invalid("delivered notifications cannot be retried");
    if (row.claimedUntil !== undefined && row.claimedUntil > Date.now()) {
      throw invalid("a delivery attempt is in progress, try again in a minute");
    }
    await ctx.db.patch(row._id, { status: "pending", attempts: 0, nextAttemptAt: Date.now(), claimedUntil: undefined, lastError: undefined });
    await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId: row._id });
    return null;
  },
});

export const automationErrors = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("automationErrors").withIndex("by_received").order("desc").take(100);
    return rows.map((r) => ({
      id: r._id,
      workflowName: r.workflowName,
      nodeName: r.nodeName,
      executionId: r.executionId,
      message: r.message,
      receivedAt: r.receivedAt,
    }));
  },
});
