import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { forbidden, unauthenticated } from "./errors";

type Ctx = QueryCtx | MutationCtx;

export async function getViewer(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const viewer = await getViewer(ctx);
  if (!viewer) throw unauthenticated();
  return viewer;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const viewer = await requireUser(ctx);
  if (viewer.role !== "admin") throw forbidden();
  return viewer;
}

// only the first name leaves the owner/borrower boundary to limit exposure
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Member";
}
