import { PageShell } from "@/components/common/page-shell";
import { Dashboard } from "@/components/dashboard/dashboard";

export default function DashboardPage() {
  return (
    <PageShell title="Dashboard" description="Your listings and loans in one place.">
      <Dashboard />
    </PageShell>
  );
}
