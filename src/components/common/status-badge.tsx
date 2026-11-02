import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type LoanStatus = "requested" | "approved" | "declined" | "cancelled" | "returned";

const STYLES: Record<LoanStatus, string> = {
  requested: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  declined: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
  cancelled: "bg-muted text-muted-foreground",
  returned: "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
};

const LABELS: Record<LoanStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
};

export function StatusBadge({ status, className }: { status: LoanStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(STYLES[status], className)}>
      {LABELS[status]}
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge variant="destructive" className="ml-1">
      Overdue
    </Badge>
  );
}

// a loan is overdue when still approved (not returned) and the end date has passed
export function isOverdue(loan: { status: string; endDate: string }, today: string): boolean {
  return loan.status === "approved" && loan.endDate < today;
}
