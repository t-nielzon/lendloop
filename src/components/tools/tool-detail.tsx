"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { formatRange } from "@/lib/dates";
import { categoryLabel, conditionLabel } from "@/lib/labels";
import { AvailabilityBadge } from "./availability-badge";
import { RequestForm } from "./request-form";

export function ToolDetail({ toolId }: { toolId: Id<"tools"> }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <ListSkeleton rows={2} />;
  if (!isAuthenticated) {
    return (
      <EmptyState
        title="Sign in to view this tool"
        description="Details and availability are shown to signed-in members."
      />
    );
  }
  return <Loaded toolId={toolId} />;
}

function Loaded({ toolId }: { toolId: Id<"tools"> }) {
  const tool = useQuery(api.tools.get, { toolId });

  if (tool === undefined) return <ListSkeleton rows={2} />;
  if (tool === null) {
    return <ErrorState message="This tool doesn't exist or is no longer available." />;
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{tool.name}</h1>
            {tool.canManage && tool.status === "active" ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/tools/${tool.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{categoryLabel(tool.category)}</Badge>
            <Badge variant="outline">{conditionLabel(tool.condition)}</Badge>
            <AvailabilityBadge availableNow={tool.availableNow} nextFreeDate={tool.nextFreeDate} />
            {tool.status === "archived" ? <Badge variant="secondary">Archived</Badge> : null}
          </div>
          <p className="whitespace-pre-line text-muted-foreground">{tool.description}</p>
          <p className="text-sm text-muted-foreground">Shared by {tool.ownerName}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booked dates</CardTitle>
          </CardHeader>
          <CardContent>
            {tool.bookedRanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved bookings yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {tool.bookedRanges.map((r) => (
                  <li key={`${r.startDate}-${r.endDate}`}>
                    {formatRange(r.startDate, r.endDate)}
                    {r.borrowerName ? (
                      <span className="text-muted-foreground"> ({r.borrowerName})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardContent className="pt-6">
          <RequestForm
            toolId={tool.id}
            isMine={tool.isMine || tool.status === "archived"}
            booked={tool.bookedRanges}
          />
        </CardContent>
      </Card>
    </div>
  );
}
