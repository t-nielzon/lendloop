"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { ToolForm } from "./tool-form";

export function NewTool() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const create = useMutation(api.tools.create);
  if (isLoading) return <ListSkeleton rows={2} />;
  if (!isAuthenticated) return <EmptyState title="Sign in to list a tool" />;
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
