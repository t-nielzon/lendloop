import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { firstName } from "./auth";

type LoanStatus = Doc<"loans">["status"];

export type LoanStatusPayload = {
  eventId: string;
  type: "loan.status_changed";
  occurredAt: string;
  loan: { id: string; status: LoanStatus; previousStatus: LoanStatus | null; startDate: string; endDate: string };
  tool: { name: string };
  recipient: { firstName: string; email: string };
  link: string;
};

// writes the audit event, the outbox row and the delivery job together so a transition can never be silent
export async function recordTransition(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  previousStatus: LoanStatus | null,
  actor: Doc<"users">,
) {
  const now = Date.now();
  await ctx.db.insert("loanEvents", {
    loanId: loan._id,
    at: now,
    actorType: "user",
    actorId: actor._id,
    type: loan.status,
  });

  const tool = await ctx.db.get(loan.toolId);
  const toOwner = loan.status === "requested" || loan.status === "cancelled";
  const recipient = await ctx.db.get(toOwner ? loan.ownerId : loan.borrowerId);
  const eventId = crypto.randomUUID();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const payload: LoanStatusPayload = {
    eventId,
    type: "loan.status_changed",
    occurredAt: new Date(now).toISOString(),
    loan: {
      id: loan._id,
      status: loan.status,
      previousStatus,
      startDate: loan.startDate,
      endDate: loan.endDate,
    },
    tool: { name: tool?.name ?? "a tool" },
    recipient: { firstName: firstName(recipient?.name ?? ""), email: recipient?.email ?? "" },
    link: `${appUrl}/loans/${loan._id}`,
  };
  const outboxId = await ctx.db.insert("outbox", {
    eventId,
    loanId: loan._id,
    payload,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId });
}
