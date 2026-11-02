"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAction } from "@/components/common/use-action";

// buttons mirror the transitions convex allows; the server remains the source of truth
export function LoanActions({
  loanId,
  status,
  canManage,
  canCancel,
}: {
  loanId: Id<"loans">;
  status: string;
  canManage?: boolean;
  canCancel?: boolean;
}) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const { pending, run } = useAction();

  if (canManage && status === "requested") {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => approve({ loanId }), "Request approved.")}>
          Approve
        </Button>
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="outline" disabled={pending}>
              Decline
            </Button>
          }
          title="Decline this request?"
          description="The borrower will be notified that the request was declined."
          confirmLabel="Decline request"
          onConfirm={() => run(() => decline({ loanId }), "Request declined.")}
        />
      </div>
    );
  }

  if (canManage && status === "approved") {
    return (
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" disabled={pending}>
            Mark returned
          </Button>
        }
        title="Mark as returned?"
        description="Confirm the tool is back with you. This closes the loan."
        confirmLabel="Mark returned"
        onConfirm={() => run(() => markReturned({ loanId }), "Marked as returned.")}
      />
    );
  }

  if (canCancel && status === "requested") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => cancel({ loanId }), "Request cancelled.")}
      >
        Cancel request
      </Button>
    );
  }

  return null;
}
