import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/common/page-shell";
import { EditTool } from "@/components/tools/edit-tool";

export default async function EditToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageShell title="Edit tool">
      <EditTool toolId={id as Id<"tools">} />
    </PageShell>
  );
}
