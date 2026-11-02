import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { firstName } from "./auth";
import { todayUtc } from "./dates";
import { lastAutomationOf } from "./loanEvents";

// emails and tokens are deliberately left out of every client-facing loan shape
export async function toLoanView(ctx: QueryCtx, loan: Doc<"loans">, today: string = todayUtc()) {
  const [tool, owner, borrower] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
  ]);
  return {
    id: loan._id,
    toolId: loan.toolId,
    toolName: tool?.name ?? "Removed tool",
    ownerId: loan.ownerId,
    ownerName: firstName(owner?.name ?? ""),
    borrowerId: loan.borrowerId,
    borrowerName: firstName(borrower?.name ?? ""),
    startDate: loan.startDate,
    endDate: loan.endDate,
    note: loan.note,
    status: loan.status,
    createdAt: loan.createdAt,
    updatedAt: loan.updatedAt,
    decidedAt: loan.decidedAt,
    returnedAt: loan.returnedAt,
    reminderCount: loan.reminderCount,
    lastAutomation: lastAutomationOf(loan),
    isOverdue: loan.status === "approved" && loan.endDate < today,
  };
}
