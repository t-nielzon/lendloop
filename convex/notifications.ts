import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { signatureHeader } from "./lib/signing";

export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
export const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;

export const getOutbox = internalQuery({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, args) => await ctx.db.get(args.outboxId),
});

// a missing config leaves the row pending without burning an attempt, so an admin fixing env loses nothing
export const markUnconfigured = internalMutation({
  args: { outboxId: v.id("outbox"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.outboxId, { lastError: args.reason });
  },
});

export const markDelivered = internalMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status !== "pending") return;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "delivered",
      attempts: row.attempts + 1,
      deliveredAt: now,
      lastError: undefined,
    });
    await ctx.db.insert("loanEvents", { loanId: row.loanId, at: now, actorType: "system", type: "notification_delivered" });
  },
});

export const markFailed = internalMutation({
  args: { outboxId: v.id("outbox"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status !== "pending") return;
    const now = Date.now();
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(row._id, { status: "dead", attempts, lastError: args.error });
      await ctx.db.insert("loanEvents", {
        loanId: row.loanId,
        at: now,
        actorType: "system",
        type: "notification_failed",
        detail: `gave up after ${attempts} attempts`,
      });
      return;
    }
    const delayMs = BACKOFF_SECONDS[attempts - 1] * 1000;
    await ctx.db.patch(row._id, { attempts, lastError: args.error, nextAttemptAt: now + delayMs });
    await ctx.scheduler.runAfter(delayMs, internal.notifications.deliver, { outboxId: row._id });
  },
});

export const deliver = internalAction({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(internal.notifications.getOutbox, { outboxId: args.outboxId });
    if (!row || row.status !== "pending") return;

    const url = process.env.N8N_LOAN_STATUS_WEBHOOK_URL;
    if (!url) {
      await ctx.runMutation(internal.notifications.markUnconfigured, {
        outboxId: row._id,
        reason: "webhook url not configured",
      });
      return;
    }
    const secret = process.env.LENDLOOP_OUTBOUND_SECRET;
    if (!secret) {
      await ctx.runMutation(internal.notifications.markUnconfigured, {
        outboxId: row._id,
        reason: "outbound secret not configured",
      });
      return;
    }

    const body = JSON.stringify(row.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LendLoop-Event-Id": row.eventId,
          "X-LendLoop-Timestamp": timestamp,
          "X-LendLoop-Signature": await signatureHeader(secret, timestamp, body),
        },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        await ctx.runMutation(internal.notifications.markDelivered, { outboxId: row._id });
      } else {
        await ctx.runMutation(internal.notifications.markFailed, { outboxId: row._id, error: `http ${res.status}` });
      }
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network error";
      await ctx.runMutation(internal.notifications.markFailed, { outboxId: row._id, error: reason });
    } finally {
      clearTimeout(timer);
    }
  },
});
