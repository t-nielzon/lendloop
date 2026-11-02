import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { firstName, requireAdmin, requireUser } from "./lib/auth";
import { assertDate, diffDays, rangesOverlap, todayUtc } from "./lib/dates";
import { forbidden, invalid } from "./lib/errors";
import { recordTransition } from "./lib/loanFlow";
import { toLoanView } from "./lib/loanView";
import { loanStatus } from "./schema";

const MAX_SPAN_DAYS = 30;
const MAX_NOTE = 500;

async function overlapsApproved(
  ctx: MutationCtx,
  toolId: Id<"tools">,
  range: { startDate: string; endDate: string },
  excludeLoanId?: Id<"loans">,
) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
  return approved.some((l) => l._id !== excludeLoanId && rangesOverlap(l, range));
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.status !== "active") throw invalid("this tool is not available to request");
    if (tool.ownerId === viewer._id) throw invalid("you cannot borrow your own tool");

    assertDate(args.startDate, "start date");
    assertDate(args.endDate, "end date");
    if (args.startDate < todayUtc()) throw invalid("start date cannot be in the past");
    if (args.endDate < args.startDate) throw invalid("end date must be on or after the start date");
    if (diffDays(args.startDate, args.endDate) > MAX_SPAN_DAYS) {
      throw invalid(`loans can span at most ${MAX_SPAN_DAYS} days`);
    }
    const note = args.note?.trim() || undefined;
    if (note && note.length > MAX_NOTE) throw invalid(`note must be at most ${MAX_NOTE} characters`);

    const range = { startDate: args.startDate, endDate: args.endDate };
    if (await overlapsApproved(ctx, tool._id, range)) {
      throw invalid("those dates overlap an approved loan");
    }
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .collect();
    const duplicate = mine.some(
      (l) =>
        l.toolId === tool._id &&
        (l.status === "requested" || l.status === "approved") &&
        rangesOverlap(l, range),
    );
    if (duplicate) throw invalid("you already have a request for those dates");

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      ...range,
      note,
      status: "requested",
      createdAt: now,
      updatedAt: now,
      reminderCount: 0,
    });
    const loan = (await ctx.db.get(loanId))!;
    await recordTransition(ctx, loan, null, viewer);
    return loanId;
  },
});

type Transition = {
  from: Doc<"loans">["status"];
  to: Doc<"loans">["status"];
  actor: "manager" | "borrower";
};

async function applyTransition(ctx: MutationCtx, loanId: Id<"loans">, t: Transition) {
  const viewer = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) throw invalid("loan not found");
  const allowed =
    t.actor === "borrower"
      ? loan.borrowerId === viewer._id
      : loan.ownerId === viewer._id || viewer.role === "admin";
  if (!allowed) throw forbidden();
  if (loan.status !== t.from) throw invalid(`a ${loan.status} loan cannot become ${t.to}`);

  // dates may have been taken by another approval since the request was made
  if (t.to === "approved") {
    const tool = await ctx.db.get(loan.toolId);
    if (!tool || tool.status !== "active") throw invalid("this tool is archived and cannot be lent");
    if (loan.startDate < todayUtc()) throw invalid("the start date has already passed");
  }
  if (t.to === "approved" && (await overlapsApproved(ctx, loan.toolId, loan, loan._id))) {
    throw invalid("those dates now overlap an approved loan");
  }

  const now = Date.now();
  const patch: Partial<Doc<"loans">> = { status: t.to, updatedAt: now };
  if (t.to === "approved" || t.to === "declined") patch.decidedAt = now;
  if (t.to === "returned") patch.returnedAt = now;
  await ctx.db.patch(loan._id, patch);
  await recordTransition(ctx, { ...loan, ...patch } as Doc<"loans">, loan.status, viewer);
  return null;
}

const loanIdArg = { loanId: v.id("loans") };

export const approve = mutation({
  args: loanIdArg,
  handler: (ctx, a) => applyTransition(ctx, a.loanId, { from: "requested", to: "approved", actor: "manager" }),
});
export const decline = mutation({
  args: loanIdArg,
  handler: (ctx, a) => applyTransition(ctx, a.loanId, { from: "requested", to: "declined", actor: "manager" }),
});
export const cancel = mutation({
  args: loanIdArg,
  handler: (ctx, a) => applyTransition(ctx, a.loanId, { from: "requested", to: "cancelled", actor: "borrower" }),
});
export const markReturned = mutation({
  args: loanIdArg,
  handler: (ctx, a) => applyTransition(ctx, a.loanId, { from: "approved", to: "returned", actor: "manager" }),
});

export const listMyRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(200);
    const today = todayUtc();
    return await Promise.all(loans.map((l) => toLoanView(ctx, l, today)));
  },
});

export const listIncoming = query({
  args: { status: v.optional(loanStatus) },
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(200);
    const filtered = args.status ? loans.filter((l) => l.status === args.status) : loans;
    const today = todayUtc();
    return await Promise.all(filtered.map((l) => toLoanView(ctx, l, today)));
  },
});

export const get = query({
  args: loanIdArg,
  handler: async (ctx, args) => {
    const viewer = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return null;
    const isParticipant = loan.ownerId === viewer._id || loan.borrowerId === viewer._id;
    if (!isParticipant && viewer.role !== "admin") throw forbidden();

    const events = await ctx.db
      .query("loanEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .collect();
    const timeline = [];
    for (const e of events) {
      const actor = e.actorId ? await ctx.db.get(e.actorId) : null;
      timeline.push({
        id: e._id,
        at: e.at,
        type: e.type,
        actorType: e.actorType,
        actorName: actor ? firstName(actor.name) : undefined,
        detail: e.detail,
      });
    }
    const view = await toLoanView(ctx, loan);
    return {
      ...view,
      viewerRole: loan.ownerId === viewer._id ? ("owner" as const) : loan.borrowerId === viewer._id ? ("borrower" as const) : ("admin" as const),
      events: timeline,
    };
  },
});

export const listAll = query({
  args: { status: v.optional(loanStatus), overdueOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const today = todayUtc();
    const status = args.overdueOnly ? "approved" : args.status;
    let loans: Doc<"loans">[];
    if (status) {
      loans = await ctx.db
        .query("loans")
        .withIndex("by_status_endDate", (q) => {
          const base = q.eq("status", status);
          return args.overdueOnly ? base.lt("endDate", today) : base;
        })
        .order("desc")
        .take(500);
    } else {
      loans = await ctx.db.query("loans").order("desc").take(500);
    }
    return await Promise.all(loans.map((l) => toLoanView(ctx, l, today)));
  },
});
