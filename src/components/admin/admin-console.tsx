"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/common/query-boundary";
import { EmptyState, ForbiddenState, ListSkeleton } from "@/components/common/states";
import { ErrorsPanel } from "./errors-panel";
import { LoansPanel } from "./loans-panel";
import { OutboxPanel } from "./outbox-panel";
import { UsersPanel } from "./users-panel";

export function AdminConsole() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.me);

  if (isLoading || (isAuthenticated && viewer === undefined)) return <ListSkeleton rows={2} />;
  if (!isAuthenticated) return <EmptyState title="Sign in to continue" />;
  // admin queries are only mounted for admins; convex enforces the same rule server-side
  if (viewer?.role !== "admin") return <ForbiddenState message="This area is for administrators." />;

  return (
    <QueryBoundary>
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="outbox">Delivery outbox</TabsTrigger>
          <TabsTrigger value="errors">Automation errors</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="loans">
          <LoansPanel />
        </TabsContent>
        <TabsContent value="outbox">
          <OutboxPanel />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorsPanel />
        </TabsContent>
      </Tabs>
    </QueryBoundary>
  );
}
