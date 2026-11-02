import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { firstName } from "./lib/auth";
import { insertLoanEvent } from "./lib/loanEvents";
import { addDays, diffDays } from "./lib/dates";
import { recordTransition } from "./lib/loanFlow";

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
    await insertLoanEvent(ctx, {
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

export const PAGE_SIZE = 200;
export const NUDGE_AFTER_MS = 48 * 3_600_000;
export const STUCK_AFTER_MS = 30 * 60_000;

// filters while iterating so already-reminded loans cannot starve later ones, same as the overdue page
export const upcomingPickups = internalQuery({
  args: { asOf: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? PAGE_SIZE;
    const tomorrow = addDays(args.asOf, 1);
    const query = ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").gte("endDate", tomorrow));
    const loans = [];
    let hasMore = false;
    for await (const loan of query) {
      if (loan.startDate !== tomorrow || loan.pickupReminderOn === args.asOf) continue;
      const [tool, borrower, owner] = await Promise.all([
        ctx.db.get(loan.toolId),
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.ownerId),
      ]);
      if (!borrower || !owner) continue;
      if (loans.length >= limit) {
        hasMore = true;
        break;
      }
      loans.push({
        loanId: loan._id,
        toolName: tool?.name ?? "a tool",
        startDate: loan.startDate,
        endDate: loan.endDate,
        borrowerFirstName: firstName(borrower.name),
        borrowerEmail: borrower.email,
        ownerFirstName: firstName(owner.name),
        ownerEmail: owner.email,
      });
    }
    return { loans, hasMore };
  },
});

type Stage = { receiptKind: string; type: "pickup_reminder_sent" | "request_nudged" };

async function seenKey(ctx: MutationCtx, key: string) {
  return !!(await ctx.db
    .query("webhookReceipts")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
    .first());
}

async function recordStage(
  ctx: MutationCtx,
  args: { idempotencyKey: string; loanId: string },
  expectedKey: string,
  stage: Stage,
  patch: (now: number) => Partial<Doc<"loans">>,
  detail: string,
): Promise<"recorded" | "duplicate" | "invalid"> {
  const loanId = ctx.db.normalizeId("loans", args.loanId);
  if (!loanId || args.idempotencyKey !== expectedKey) return "invalid";
  if (!(await ctx.db.get(loanId))) return "invalid";
  if (await seenKey(ctx, args.idempotencyKey)) return "duplicate";
  const now = Date.now();
  await ctx.db.insert("webhookReceipts", { idempotencyKey: args.idempotencyKey, kind: stage.receiptKind, loanId, receivedAt: now });
  await ctx.db.patch(loanId, { ...patch(now), updatedAt: now });
  await insertLoanEvent(ctx, { loanId, at: now, actorType: "automation", type: stage.type, detail });
  return "recorded";
}

export const recordPickupReminder = internalMutation({
  args: { idempotencyKey: v.string(), loanId: v.string(), asOf: v.string() },
  handler: (ctx, args) =>
    recordStage(
      ctx,
      args,
      `pickup-reminder:${args.loanId}:${args.asOf}`,
      { receiptKind: "pickup-reminder-sent", type: "pickup_reminder_sent" },
      () => ({ pickupReminderOn: args.asOf }),
      `pickup reminder for ${args.asOf}`,
    ),
});

export const recordNudge = internalMutation({
  args: { idempotencyKey: v.string(), loanId: v.string() },
  handler: async (ctx, args): Promise<"recorded" | "duplicate" | "skipped" | "invalid"> => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    // a decision made after the email went out must not leave a nudge trace on the loan
    if (loan && loan.status !== "requested" && args.idempotencyKey === `request-nudge:${args.loanId}`) return "skipped";
    return recordStage(
      ctx,
      args,
      `request-nudge:${args.loanId}`,
      { receiptKind: "request-nudged", type: "request_nudged" },
      (now) => ({ nudgedAt: now }),
      "owner nudged after 48 hours without a decision",
    );
  },
});

export const staleRequests = internalQuery({
  args: { asOf: v.string(), now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? PAGE_SIZE;
    const nowMs = args.now ?? Date.now();
    const cutoff = nowMs - NUDGE_AFTER_MS;
    const toNudge = [];
    const toExpire = [];
    let hasMore = false;
    const requested = ctx.db.query("loans").withIndex("by_status_endDate", (q) => q.eq("status", "requested"));
    for await (const loan of requested) {
      const expire = loan.startDate < args.asOf;
      const nudge = !expire && loan.createdAt <= cutoff && loan.nudgedAt === undefined;
      if (!expire && !nudge) continue;
      const [tool, borrower, owner] = await Promise.all([
        ctx.db.get(loan.toolId),
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.ownerId),
      ]);
      if (!borrower || !owner) continue;
      if (toNudge.length + toExpire.length >= limit) {
        hasMore = true;
        break;
      }
      const toolName = tool?.name ?? "a tool";
      if (expire) {
        toExpire.push({ loanId: loan._id, toolName, startDate: loan.startDate, borrowerFirstName: firstName(borrower.name) });
      } else {
        toNudge.push({
          loanId: loan._id,
          toolName,
          startDate: loan.startDate,
          endDate: loan.endDate,
          ownerFirstName: firstName(owner.name),
          ownerEmail: owner.email,
          borrowerFirstName: firstName(borrower.name),
          ageHours: Math.floor((nowMs - loan.createdAt) / 3_600_000),
        });
      }
    }
    return { toNudge, toExpire, hasMore };
  },
});

// a loan decided or already expired in the meantime is skipped, never failed, so n8n does not error on a race the human won
export const expireRequest = internalMutation({
  args: { idempotencyKey: v.string(), loanId: v.string(), asOf: v.string() },
  handler: async (ctx, args): Promise<"recorded" | "duplicate" | "skipped" | "invalid"> => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || args.idempotencyKey !== `request-expire:${args.loanId}`) return "invalid";
    const loan = await ctx.db.get(loanId);
    if (!loan) return "invalid";
    if (await seenKey(ctx, args.idempotencyKey)) return "duplicate";
    if (loan.status !== "requested" || loan.startDate >= args.asOf) return "skipped";
    const now = Date.now();
    await ctx.db.insert("webhookReceipts", { idempotencyKey: args.idempotencyKey, kind: "request-expired", loanId, receivedAt: now });
    const patch: Partial<Doc<"loans">> = { status: "expired", updatedAt: now };
    await ctx.db.patch(loanId, patch);
    await recordTransition(ctx, { ...loan, ...patch } as Doc<"loans">, "requested", null);
    return "recorded";
  },
});

// counts stop at this cap so a runaway outbox cannot make the check expensive
export const HEALTH_COUNT_CAP = 1000;

export const deliveryHealth = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stuckBefore = Date.now() - STUCK_AFTER_MS;
    const dead = () => ctx.db.query("outbox").withIndex("by_status_createdAt", (q) => q.eq("status", "dead"));
    const stuck = () =>
      ctx.db.query("outbox").withIndex("by_status_createdAt", (q) => q.eq("status", "pending").lt("createdAt", stuckBefore));
    const [deadRows, stuckRows, oldestDead, oldestStuck] = await Promise.all([
      dead().take(HEALTH_COUNT_CAP + 1),
      stuck().take(HEALTH_COUNT_CAP + 1),
      dead().order("asc").first(),
      stuck().order("asc").first(),
    ]);
    const oldestAt = Math.min(oldestDead?.createdAt ?? Infinity, oldestStuck?.createdAt ?? Infinity);
    let incidentRowId: string | null = null;
    if (oldestAt !== Infinity) {
      // rows sharing the oldest timestamp are tie-broken by id so the incident key is deterministic
      const ties = await Promise.all([
        ctx.db.query("outbox").withIndex("by_status_createdAt", (q) => q.eq("status", "dead").eq("createdAt", oldestAt)).take(100),
        ctx.db.query("outbox").withIndex("by_status_createdAt", (q) => q.eq("status", "pending").eq("createdAt", oldestAt)).take(100),
      ]);
      incidentRowId = ties.flat().map((r) => r._id as string).sort()[0];
    }
    return {
      dead: Math.min(deadRows.length, HEALTH_COUNT_CAP),
      stuckPending: Math.min(stuckRows.length, HEALTH_COUNT_CAP),
      countCapped: deadRows.length > HEALTH_COUNT_CAP || stuckRows.length > HEALTH_COUNT_CAP,
      oldestStuckAt: oldestStuck?.createdAt ?? null,
      incidentRowId,
    };
  },
});

export const healthAlertSeen = internalQuery({
  args: { incidentKey: v.string() },
  handler: async (ctx, args) =>
    (await ctx.db.query("healthAlerts").withIndex("by_key", (q) => q.eq("incidentKey", args.incidentKey)).first()) !== null,
});

export const recordHealthAlert = internalMutation({
  args: {
    idempotencyKey: v.string(),
    incidentKey: v.string(),
    dead: v.number(),
    stuckPending: v.number(),
    oldestStuckAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<"recorded" | "duplicate" | "invalid"> => {
    if (args.idempotencyKey !== `health-alert:${args.incidentKey}`) return "invalid";
    const existing = await ctx.db
      .query("healthAlerts")
      .withIndex("by_key", (q) => q.eq("incidentKey", args.incidentKey))
      .first();
    if (existing) return "duplicate";
    const now = Date.now();
    await ctx.db.insert("healthAlerts", {
      incidentKey: args.incidentKey,
      dead: args.dead,
      stuckPending: args.stuckPending,
      oldestStuckAt: args.oldestStuckAt,
      sentAt: now,
    });
    return "recorded";
  },
});
