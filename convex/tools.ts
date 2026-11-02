import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { firstName, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { forbidden, invalid } from "./lib/errors";
import { recordTransition } from "./lib/loanFlow";
import { approvedLoans, computeAvailability, findTools } from "./lib/toolView";
import { toolCategory, toolCondition } from "./schema";

const availabilityArg = v.union(v.literal("all"), v.literal("available"), v.literal("on-loan"));
const filterArgs = {
  search: v.optional(v.string()),
  category: v.optional(toolCategory),
  availability: v.optional(availabilityArg),
};

function validateFields(f: { name?: string; description?: string }) {
  if (f.name !== undefined) {
    const n = f.name.trim();
    if (n.length < 1 || n.length > 80) throw invalid("name must be 1-80 characters");
  }
  if (f.description !== undefined && f.description.trim().length > 1000) {
    throw invalid("description must be at most 1000 characters");
  }
}

// no owner field here on purpose: the public page must not reveal who owns what
export const listPublic = query({
  args: filterArgs,
  handler: async (ctx, args) => {
    const rows = await findTools(ctx, args);
    return rows.map(({ tool, availableNow, nextFreeDate }) => ({
      id: tool._id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      condition: tool.condition,
      availableNow,
      nextFreeDate,
    }));
  },
});

export const list = query({
  args: filterArgs,
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const rows = await findTools(ctx, args);
    const out = [];
    for (const { tool, availableNow, nextFreeDate } of rows) {
      const owner = await ctx.db.get(tool.ownerId);
      out.push({
        id: tool._id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        condition: tool.condition,
        availableNow,
        nextFreeDate,
        ownerName: owner ? firstName(owner.name) : "Member",
        isMine: tool.ownerId === viewer._id,
      });
    }
    return out;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    const today = todayUtc();
    const out = [];
    for (const tool of tools) {
      const a = computeAvailability(await approvedLoans(ctx, tool._id), today);
      out.push({
        id: tool._id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        condition: tool.condition,
        status: tool.status,
        availableNow: a.availableNow,
        nextFreeDate: a.nextFreeDate,
      });
    }
    return out;
  },
});

export const get = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) return null;
    const isOwnerOrAdmin = tool.ownerId === viewer._id || viewer.role === "admin";
    if (tool.status === "archived" && !isOwnerOrAdmin) return null;
    const owner = await ctx.db.get(tool.ownerId);
    const loans = await approvedLoans(ctx, tool._id);
    const today = todayUtc();
    const bookedRanges = [];
    for (const l of loans.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      const borrower = isOwnerOrAdmin ? await ctx.db.get(l.borrowerId) : null;
      bookedRanges.push({
        loanId: isOwnerOrAdmin ? l._id : undefined,
        startDate: l.startDate,
        endDate: l.endDate,
        borrowerName: borrower ? firstName(borrower.name) : undefined,
      });
    }
    const a = computeAvailability(loans, today);
    return {
      id: tool._id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      condition: tool.condition,
      status: tool.status,
      ownerName: owner ? firstName(owner.name) : "Member",
      isMine: tool.ownerId === viewer._id,
      canManage: isOwnerOrAdmin,
      availableNow: a.availableNow,
      nextFreeDate: a.nextFreeDate,
      bookedRanges,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: toolCategory,
    condition: toolCondition,
  },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    validateFields(args);
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name: args.name.trim(),
      description: args.description.trim(),
      category: args.category,
      condition: args.condition,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function loadManageable(ctx: Parameters<typeof requireUser>[0], toolId: Doc<"tools">["_id"]) {
  const viewer = await requireUser(ctx);
  const tool = await ctx.db.get(toolId);
  if (!tool) throw invalid("tool not found");
  if (tool.ownerId !== viewer._id && viewer.role !== "admin") throw forbidden();
  return tool;
}

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(toolCategory),
    condition: v.optional(toolCondition),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    const tool = await loadManageable(ctx, toolId);
    if (tool.status === "archived") throw invalid("archived tools cannot be edited");
    validateFields(fields);
    const patch: Partial<Doc<"tools">> = { updatedAt: Date.now() };
    if (fields.name !== undefined) patch.name = fields.name.trim();
    if (fields.description !== undefined) patch.description = fields.description.trim();
    if (fields.category !== undefined) patch.category = fields.category;
    if (fields.condition !== undefined) patch.condition = fields.condition;
    await ctx.db.patch(toolId, patch);
    return null;
  },
});

export const archive = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const tool = await loadManageable(ctx, args.toolId);
    if (tool.status === "archived") return null;
    const now = Date.now();
    await ctx.db.patch(args.toolId, { status: "archived", updatedAt: now });
    // pending requests on an archived tool could never be approved, so the borrowers are told now
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", args.toolId).eq("status", "requested"))
      .collect();
    const archiver = await requireUser(ctx);
    for (const loan of pending) {
      const patch = { status: "declined" as const, updatedAt: now, decidedAt: now };
      await ctx.db.patch(loan._id, patch);
      await recordTransition(ctx, { ...loan, ...patch }, loan.status, archiver, "tool archived");
    }
    return null;
  },
});
