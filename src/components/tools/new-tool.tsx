"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useViewer } from "@/components/common/use-viewer";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { ToolForm } from "./tool-form";

export function NewTool() {
  const { status } = useViewer();
  const create = useMutation(api.tools.create);
  if (status === "loading") return <ListSkeleton rows={2} />;
  if (status === "anonymous") return <EmptyState title="Sign in to list a tool" />;
  return (
    <ToolForm
      initial={{ name: "", description: "", category: "other", condition: "good" }}
      submitLabel="List tool"
      successMessage="Tool listed."
      cancelHref="/dashboard"
      onSubmit={(values) => create(values)}
    />
  );
}
