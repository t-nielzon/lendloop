import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getViewer, requireAdmin } from "./lib/auth";
import { forbidden, invalid } from "./lib/errors";
import { role } from "./schema";

// admin allowlist lives in deployment env so roles are never client-supplied
function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export const me = query({
  args: {},
  handler: async (ctx) => await getViewer(ctx),
});

export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });

    const name = identity.name ?? identity.givenName ?? "Member";
    const email = identity.email ?? "";
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      // role is deliberately untouched here so admin changes survive sign-ins
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: isAdminEmail(email) ? "admin" : "user",
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map((u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }));
  },
});

export const setRole = mutation({
  args: { userId: v.id("users"), role },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    // blocking self-change guarantees the last admin cannot lock everyone out
    if (admin._id === args.userId) throw forbidden();
    const target = await ctx.db.get(args.userId);
    if (!target) throw invalid("user not found");
    await ctx.db.patch(args.userId, { role: args.role });
    return null;
  },
});
