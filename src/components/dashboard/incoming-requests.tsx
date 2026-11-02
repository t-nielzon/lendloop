"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { LoanActions } from "@/components/loans/loan-actions";
import { LoanRow } from "@/components/loans/loan-row";

const STATUSES = ["requested", "approved", "declined", "cancelled", "returned"] as const;
type Status = (typeof STATUSES)[number];

export function IncomingRequests() {
  const [status, setStatus] = useState<Status | "all">("all");
  const loans = useQuery(api.loans.listIncoming, status === "all" ? {} : { status });

  return (
    <div className="space-y-4">
      <div className="w-48 space-y-1.5">
        <Label htmlFor="incoming-status">Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as Status | "all")}>
          <SelectTrigger id="incoming-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loans === undefined ? (
        <ListSkeleton />
      ) : loans.length === 0 ? (
        <EmptyState
          title="No incoming requests"
          description="When someone asks to borrow one of your tools it will show up here."
        />
      ) : (
        <ul className="space-y-3">
          {loans.map((loan) => (
            <li key={loan.id}>
              <LoanRow
                loan={loan}
                subtitle={`Borrower: ${loan.borrowerName}`}
                actions={<LoanActions loanId={loan.id} status={loan.status} canManage />}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
