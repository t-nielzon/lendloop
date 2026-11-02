import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { OverdueBadge, StatusBadge, type LoanStatus } from "@/components/common/status-badge";
import { AutomationLine } from "./automation-line";
import { formatRange } from "@/lib/dates";

export type LoanRowData = {
  id: string;
  toolName: string;
  startDate: string;
  endDate: string;
  status: string;
  isOverdue: boolean;
  lastAutomation?: { type: string; at: number } | null;
};

export function LoanRow({
  loan,
  subtitle,
  actions,
}: {
  loan: LoanRowData;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0 space-y-1">
          <Link href={`/loans/${loan.id}`} className="font-medium hover:underline focus-visible:underline">
            {loan.toolName}
          </Link>
          <p className="text-sm text-muted-foreground">
            {subtitle} · {formatRange(loan.startDate, loan.endDate)}
          </p>
          <div>
            <StatusBadge status={loan.status as LoanStatus} />
            {loan.isOverdue ? <OverdueBadge /> : null}
          </div>
          {loan.lastAutomation ? <AutomationLine automation={loan.lastAutomation} /> : null}
        </div>
        {actions}
      </CardContent>
    </Card>
  );
}
