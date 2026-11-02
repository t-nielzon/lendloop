import type { Id } from "../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/common/page-shell";
import { LoanDetail } from "@/components/loans/loan-detail";

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageShell title="Loan details">
      <LoanDetail loanId={id as Id<"loans">} />
    </PageShell>
  );
}
