import { PageShell } from "@/components/common/page-shell";
import { NewTool } from "@/components/tools/new-tool";

export default function NewToolPage() {
  return (
    <PageShell title="List a tool" description="Share something with your neighbours.">
      <NewTool />
    </PageShell>
  );
}
