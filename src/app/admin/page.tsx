import { PageShell } from "@/components/common/page-shell";
import { AdminConsole } from "@/components/admin/admin-console";

export default function AdminPage() {
  return (
    <PageShell title="Admin" description="Users, loans and automation health.">
      <AdminConsole />
    </PageShell>
  );
}
