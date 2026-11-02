"use client";

import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAction } from "@/components/common/use-action";
import { EmptyState, ErrorState, ForbiddenState, ListSkeleton } from "@/components/common/states";
import type { Category, Condition } from "@/lib/labels";
import { ToolForm } from "./tool-form";

export function EditTool({ toolId }: { toolId: Id<"tools"> }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <ListSkeleton rows={2} />;
  if (!isAuthenticated) return <EmptyState title="Sign in to edit tools" />;
  return <Loaded toolId={toolId} />;
}

function Loaded({ toolId }: { toolId: Id<"tools"> }) {
  const tool = useQuery(api.tools.get, { toolId });
  const update = useMutation(api.tools.update);
  const archive = useMutation(api.tools.archive);
  const router = useRouter();
  const { pending, run } = useAction();

  if (tool === undefined) return <ListSkeleton rows={2} />;
  if (tool === null) return <ErrorState message="This tool doesn't exist." />;
  if (!tool.canManage) return <ForbiddenState message="Only the owner can edit this tool." />;
  if (tool.status === "archived") return <ErrorState message="Archived tools can't be edited." />;

  async function onArchive() {
    const done = await run(() => archive({ toolId }), "Tool archived.");
    if (done !== undefined) router.push("/dashboard");
  }

  return (
    <div className="space-y-8">
      <ToolForm
        initial={{
          name: tool.name,
          description: tool.description,
          category: tool.category as Category,
          condition: tool.condition as Condition,
        }}
        submitLabel="Save changes"
        successMessage="Tool updated."
        cancelHref={`/tools/${toolId}`}
        onSubmit={(values) => update({ toolId, ...values })}
      />
      <div className="max-w-xl rounded-lg border p-4">
        <h2 className="font-medium">Archive this tool</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Archived tools disappear from the catalog and can't be requested.
        </p>
        <ConfirmDialog
          trigger={
            <Button variant="destructive" disabled={pending}>
              Archive tool
            </Button>
          }
          title="Archive this tool?"
          description="It will be removed from the catalog. Existing loan history is kept."
          confirmLabel="Archive"
          onConfirm={onArchive}
        />
      </div>
    </div>
  );
}
