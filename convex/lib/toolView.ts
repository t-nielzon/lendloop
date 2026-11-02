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

export async function findTools(ctx: QueryCtx, filters: ToolFilters) {
  const search = filters.search?.trim();
  let tools: Doc<"tools">[];
  if (search) {
    tools = await ctx.db
      .query("tools")
      .withSearchIndex("search_name", (q) => {
        const base = q.search("name", search).eq("status", "active");
        return filters.category ? base.eq("category", filters.category) : base;
      })
      .take(100);
  } else {
    const all = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(200);
    tools = filters.category ? all.filter((t) => t.category === filters.category) : all;
  }
  const today = todayUtc();
  const rows = [];
  for (const tool of tools) {
    const availability = computeAvailability(await approvedLoans(ctx, tool._id), today);
    if (filters.availability === "available" && !availability.availableNow) continue;
    if (filters.availability === "on-loan" && availability.availableNow) continue;
    rows.push({ tool, ...availability });
  }
  return rows;
}
