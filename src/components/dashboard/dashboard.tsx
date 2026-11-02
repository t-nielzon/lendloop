"use client";

import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { IncomingRequests } from "./incoming-requests";
import { MyListings } from "./my-listings";
import { MyRequests } from "./my-requests";

export function Dashboard() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <ListSkeleton />;
  if (!isAuthenticated) return <EmptyState title="Sign in to see your dashboard" />;

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
        <MyListings />
      </TabsContent>
      <TabsContent value="requests">
        <MyRequests />
      </TabsContent>
      <TabsContent value="incoming">
        <IncomingRequests />
      </TabsContent>
    </Tabs>
  );
}
