import type { Id } from "../../../../convex/_generated/dataModel";
import { ToolDetail } from "@/components/tools/tool-detail";

export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <ToolDetail toolId={id as Id<"tools">} />
    </main>
  );
}
