import { Suspense } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/common/page-shell";
import { LoanDetail } from "@/components/loans/loan-detail";

// params is runtime data, so it is resolved under suspense to keep the static shell instant
async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LoanDetail loanId={id as Id<"loans">} />;
}

export default function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageShell title="Loan details">
      <Suspense fallback={null}>
        <Detail params={params} />
      </Suspense>
    </PageShell>
  );
}
