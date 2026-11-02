"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OverdueBadge, StatusBadge, type LoanStatus } from "@/components/common/status-badge";
import { QueryBoundary } from "@/components/common/query-boundary";
import { useViewer } from "@/components/common/use-viewer";
import { EmptyState, ListSkeleton, NotFoundState } from "@/components/common/states";
import { formatDateTime, formatRange } from "@/lib/dates";
import { AutomationLine } from "./automation-line";
import { LoanActions } from "./loan-actions";
import { LoanTimeline } from "./loan-timeline";

export function LoanDetail({ loanId }: { loanId: Id<"loans"> }) {
  const { status } = useViewer();
  if (status === "loading") return <ListSkeleton rows={2} />;
  if (status === "anonymous") return <EmptyState title="Sign in to view this loan" />;
  return (
    <QueryBoundary>
      <Loaded loanId={loanId} />
    </QueryBoundary>
  );
}

function Loaded({ loanId }: { loanId: Id<"loans"> }) {
  const loan = useQuery(api.loans.get, { loanId });

  if (loan === undefined) return <ListSkeleton rows={2} />;
  if (loan === null) return <NotFoundState message="This loan doesn't exist." />;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Link href={`/tools/${loan.toolId}`} className="hover:underline">
              {loan.toolName}
            </Link>
            <span>
              <StatusBadge status={loan.status as LoanStatus} />
              {loan.isOverdue ? <OverdueBadge /> : null}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Dates</dt>
            <dd>{formatRange(loan.startDate, loan.endDate)}</dd>
            <dt className="text-muted-foreground">Owner</dt>
            <dd>{loan.ownerName}</dd>
            <dt className="text-muted-foreground">Borrower</dt>
            <dd>{loan.borrowerName}</dd>
            <dt className="text-muted-foreground">Requested</dt>
            <dd>{formatDateTime(loan.createdAt)}</dd>
            {loan.note ? (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd className="whitespace-pre-line">{loan.note}</dd>
              </>
            ) : null}
            {loan.lastAutomation ? (
              <>
                <dt className="text-muted-foreground">Last automation</dt>
                <dd>
                  <AutomationLine automation={loan.lastAutomation} />
                </dd>
              </>
            ) : null}
            {loan.reminderCount > 0 ? (
              <>
                <dt className="text-muted-foreground">Reminders</dt>
                <dd>{loan.reminderCount} sent</dd>
              </>
            ) : null}
          </dl>
          <LoanActions loanId={loan.id} status={loan.status} canManage={loan.canManage} canCancel={loan.canCancel} />
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <LoanTimeline events={loan.events} />
        </CardContent>
      </Card>
    </div>
  );
}
