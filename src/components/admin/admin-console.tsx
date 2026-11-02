"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/common/query-boundary";
import { useViewer } from "@/components/common/use-viewer";
import { EmptyState, ForbiddenState, ListSkeleton } from "@/components/common/states";
import { ErrorsPanel } from "./errors-panel";
import { HealthAlertsPanel } from "./health-alerts-panel";
import { LoansPanel } from "./loans-panel";
import { OutboxPanel } from "./outbox-panel";
import { UsersPanel } from "./users-panel";

export function AdminConsole() {
  const { status, viewer } = useViewer();

  if (status === "loading") return <ListSkeleton rows={2} />;
  if (status === "anonymous") return <EmptyState title="Sign in to continue" />;
  // admin queries are only mounted for admins; convex enforces the same rule server-side
  if (viewer.role !== "admin") return <ForbiddenState message="This area is for administrators." />;

  return (
    <QueryBoundary>
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="outbox">Delivery outbox</TabsTrigger>
          <TabsTrigger value="errors">Automation errors</TabsTrigger>
          <TabsTrigger value="health">Health alerts</TabsTrigger>
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
        <TabsContent value="health">
          <HealthAlertsPanel />
        </TabsContent>
      </Tabs>
    </QueryBoundary>
  );
}
