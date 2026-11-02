"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { LoanActions } from "@/components/loans/loan-actions";
import { LoanRow } from "@/components/loans/loan-row";

export function MyRequests() {
  const loans = useQuery(api.loans.listMyRequests);
  if (loans === undefined) return <ListSkeleton />;
  if (loans.length === 0) {
    return (
      <EmptyState
        title="No requests yet"
        description="Find a tool in the catalog and send your first request."
        action={
          <Button asChild variant="outline">
            <Link href="/">Browse tools</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="space-y-3">
      {loans.map((loan) => (
        <li key={loan.id}>
          <LoanRow
            loan={loan}
            subtitle={`Owner: ${loan.ownerName}`}
            actions={<LoanActions loanId={loan.id} status={loan.status} canCancel />}
          />
        </li>
      ))}
    </ul>
  );
}
