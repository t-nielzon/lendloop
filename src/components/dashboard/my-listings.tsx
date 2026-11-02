"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { AvailabilityBadge } from "@/components/tools/availability-badge";
import { categoryLabel } from "@/lib/labels";

export function MyListings() {
  const tools = useQuery(api.tools.listMine);
  if (tools === undefined) return <ListSkeleton />;
  if (tools.length === 0) {
    return (
      <EmptyState
        title="You haven&apos;t listed anything"
        description="Share a tool and neighbours can start requesting it."
        action={
          <Button asChild>
            <Link href="/tools/new">List a tool</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="space-y-3">
      {tools.map((tool) => (
        <li key={tool.id}>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="space-y-1">
                <Link href={`/tools/${tool.id}`} className="font-medium hover:underline focus-visible:underline">
                  {tool.name}
                </Link>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{categoryLabel(tool.category)}</Badge>
                  {tool.status === "archived" ? (
                    <Badge variant="secondary">Archived</Badge>
                  ) : (
                    <AvailabilityBadge availableNow={tool.availableNow} nextFreeDate={tool.nextFreeDate} />
                  )}
                </div>
              </div>
              {tool.status === "active" ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tools/${tool.id}/edit`}>Edit</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
