import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { addDays, todayUtc } from "./dates";

export type Availability = "all" | "available" | "on-loan";
export type ToolFilters = { search?: string; category?: Doc<"tools">["category"]; availability?: Availability };

export async function approvedLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

// an approved loan that has started and not been returned keeps the tool out, even when overdue
export function computeAvailability(loans: Doc<"loans">[], today: string) {
  const started = loans.filter((l) => l.startDate <= today);
  if (started.length === 0) return { availableNow: true, nextFreeDate: undefined as string | undefined };
  let cursor = today;
  for (const l of started) {
    const free = addDays(l.endDate < today ? today : l.endDate, 1);
    if (free > cursor) cursor = free;
  }
  // later approved bookings that begin right after still block, so walk forward through back-to-back ranges
  const future = loans.filter((l) => l.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const l of future) {
    if (l.startDate <= cursor) {
      const free = addDays(l.endDate, 1);
      if (free > cursor) cursor = free;
    }
  }
  return { availableNow: false, nextFreeDate: cursor as string | undefined };
}

const MAX_TOOLS = 100;

// every filter runs while streaming rows and the limit is applied last, so a filter can never miss
// matches that sit beyond an arbitrary window of the newest rows
export async function findTools(ctx: QueryCtx, filters: ToolFilters) {
  const search = filters.search?.trim();
  const category = filters.category;
  const candidates = search
    ? ctx.db.query("tools").withSearchIndex("search_name", (q) => {
        const base = q.search("name", search).eq("status", "active");
        return category ? base.eq("category", category) : base;
      })
    : category
      ? ctx.db
          .query("tools")
          .withIndex("by_status_category", (q) => q.eq("status", "active").eq("category", category))
          .order("desc")
      : ctx.db
          .query("tools")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .order("desc");
  const today = todayUtc();
  const rows = [];
  for await (const tool of candidates) {
    const availability = computeAvailability(await approvedLoans(ctx, tool._id), today);
    if (filters.availability === "available" && !availability.availableNow) continue;
    if (filters.availability === "on-loan" && availability.availableNow) continue;
    rows.push({ tool, ...availability });
    if (rows.length >= MAX_TOOLS) break;
  }
  return rows;
}
