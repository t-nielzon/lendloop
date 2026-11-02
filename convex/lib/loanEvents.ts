import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type EventType = Doc<"loanEvents">["type"];

const AUTOMATION_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  "notification_delivered",
  "notification_failed",
  "reminder_sent",
  "pickup_reminder_sent",
  "request_nudged",
  "expired",
]);

export const isAutomationEvent = (type: EventType) => AUTOMATION_EVENTS.has(type);

export type LoanEventInput = {
  loanId: Id<"loans">;
  at: number;
  actorType: Doc<"loanEvents">["actorType"];
  actorId?: Id<"users">;
  type: EventType;
  detail?: string;
};

// the single insertion path for loan events so the denormalized automation fields on the loan can never drift
export async function insertLoanEvent(ctx: MutationCtx, event: LoanEventInput) {
  await ctx.db.insert("loanEvents", event);
  if (isAutomationEvent(event.type)) {
    await ctx.db.patch(event.loanId, { lastAutomationAt: event.at, lastAutomationType: event.type });
  }
}

export const lastAutomationOf = (loan: Doc<"loans">) =>
  loan.lastAutomationAt !== undefined && loan.lastAutomationType !== undefined
    ? { type: loan.lastAutomationType, at: loan.lastAutomationAt }
    : null;
