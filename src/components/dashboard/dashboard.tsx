"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/common/query-boundary";
import { useViewer } from "@/components/common/use-viewer";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { IncomingRequests } from "./incoming-requests";
import { MyListings } from "./my-listings";
import { MyRequests } from "./my-requests";

export function Dashboard() {
  const { status } = useViewer();
  if (status === "loading") return <ListSkeleton />;
  if (status === "anonymous") return <EmptyState title="Sign in to see your dashboard" />;

  return (
    <Tabs defaultValue="listings" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="listings">My listings</TabsTrigger>
          <TabsTrigger value="requests">My requests</TabsTrigger>
          <TabsTrigger value="incoming">Incoming requests</TabsTrigger>
        </TabsList>
        <Button asChild size="sm">
          <Link href="/tools/new">List a tool</Link>
        </Button>
      </div>
      <TabsContent value="listings">
        <QueryBoundary>
          <MyListings />
        </QueryBoundary>
      </TabsContent>
      <TabsContent value="requests">
        <QueryBoundary>
          <MyRequests />
        </QueryBoundary>
      </TabsContent>
      <TabsContent value="incoming">
        <QueryBoundary>
          <IncomingRequests />
        </QueryBoundary>
      </TabsContent>
    </Tabs>
  );
}
