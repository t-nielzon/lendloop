import { Suspense } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/common/page-shell";
import { EditTool } from "@/components/tools/edit-tool";

// params is runtime data, so it is resolved under suspense to keep the static shell instant
async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditTool toolId={id as Id<"tools">} />;
}

export default function EditToolPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageShell title="Edit tool">
      <Suspense fallback={null}>
        <Editor params={params} />
      </Suspense>
    </PageShell>
  );
}
