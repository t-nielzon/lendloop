import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { firstName } from "./lib/auth";
import { diffDays } from "./lib/dates";

export const OVERDUE_PAGE_SIZE = 200;

// filters while iterating the index so already-reminded loans cannot starve later ones; hasMore tells the caller to ask again
export const overdueLoans = internalQuery({
  args: { asOf: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? OVERDUE_PAGE_SIZE;
    const query = ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", args.asOf));
    const out = [];
    let hasMore = false;
    for await (const loan of query) {
      if (loan.lastReminderOn === args.asOf) continue;
      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      if (!borrower) continue;
      if (out.length >= limit) {
        hasMore = true;
        break;
      }
      out.push({
        loanId: loan._id,
        toolName: tool?.name ?? "a tool",
        borrowerFirstName: firstName(borrower.name),
        borrowerEmail: borrower.email,
        endDate: loan.endDate,
        daysOverdue: diffDays(loan.endDate, args.asOf),
      });
    }
    return { loans: out, hasMore };
  },
});

// receipt, loan patch and event share one transaction so a retry can never double count
export const recordReminder = internalMutation({
  args: { idempotencyKey: v.string(), loanId: v.string(), asOf: v.string() },
  handler: async (ctx, args): Promise<"recorded" | "duplicate" | "invalid"> => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || args.idempotencyKey !== `overdue-reminder:${args.loanId}:${args.asOf}`) return "invalid";
    const loan = await ctx.db.get(loanId);
    if (!loan) return "invalid";
    const seen = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (seen) return "duplicate";
    const now = Date.now();
    await ctx.db.insert("webhookReceipts", { idempotencyKey: args.idempotencyKey, kind: "reminder-sent", loanId, receivedAt: now });
    await ctx.db.patch(loanId, { lastReminderOn: args.asOf, reminderCount: loan.reminderCount + 1, updatedAt: now });
    await ctx.db.insert("loanEvents", {
      loanId,
      at: now,
      actorType: "automation",
      type: "reminder_sent",
      detail: `overdue reminder for ${args.asOf}`,
    });
    return "recorded";
  },
});

export const recordAutomationError = internalMutation({
  args: {
    idempotencyKey: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    executionId: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<"recorded" | "duplicate"> => {
    const seen = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (seen) return "duplicate";
    const now = Date.now();
    await ctx.db.insert("webhookReceipts", { idempotencyKey: args.idempotencyKey, kind: "workflow-error", receivedAt: now });
    await ctx.db.insert("automationErrors", {
      workflowName: args.workflowName.slice(0, 200),
      nodeName: args.nodeName?.slice(0, 200),
      executionId: args.executionId?.slice(0, 100),
      message: args.message.slice(0, 500),
      receivedAt: now,
      idempotencyKey: args.idempotencyKey,
    });
    return "recorded";
  },
});
