"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelativeTime } from "@/components/common/relative-time";
import { EmptyState, ListSkeleton } from "@/components/common/states";

export function HealthAlertsPanel() {
  const rows = useQuery(api.admin.healthAlerts);
  if (rows === undefined) return <ListSkeleton />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No health alerts"
        description="When notification delivery gets stuck or fails for good, the monitor emails the alert address and the incident is listed here."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Incident</TableHead>
            <TableHead>Dead</TableHead>
            <TableHead>Stuck pending</TableHead>
            <TableHead>Oldest stuck</TableHead>
            <TableHead>Alert sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs" title={r.incidentKey}>
                {r.incidentKey.slice(0, 8)}
              </TableCell>
              <TableCell>{r.dead}</TableCell>
              <TableCell>{r.stuckPending}</TableCell>
              <TableCell>{r.oldestStuckAt ? <RelativeTime at={r.oldestStuckAt} /> : "-"}</TableCell>
              <TableCell>
                <RelativeTime at={r.sentAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
