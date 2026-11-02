import { Suspense } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ToolDetail } from "@/components/tools/tool-detail";

// params is runtime data, so it is resolved under suspense to keep the static shell instant
async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ToolDetail toolId={id as Id<"tools">} />;
}

export default function ToolPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}
