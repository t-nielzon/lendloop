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
type Filter = "all" | "overdue" | (typeof STATUSES)[number];

export function LoansPanel() {
  const [filter, setFilter] = useState<Filter>("all");
  const args = filter === "all" ? {} : filter === "overdue" ? { overdueOnly: true } : { status: filter };
  const loans = useQuery(api.loans.listAll, args);

  return (
    <div className="space-y-4">
      <div className="w-48 space-y-1.5">
        <Label htmlFor="admin-loan-filter">Filter</Label>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger id="admin-loan-filter" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All loans</SelectItem>
            <SelectItem value="overdue">Overdue only</SelectItem>
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
        <EmptyState title="No loans match this filter" />
      ) : (
        <ul className="space-y-3">
          {loans.map((loan) => (
            <li key={loan.id}>
              <LoanRow
                loan={loan}
                subtitle={`${loan.ownerName} to ${loan.borrowerName}`}
                actions={<LoanActions loanId={loan.id} status={loan.status} canManage />}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
