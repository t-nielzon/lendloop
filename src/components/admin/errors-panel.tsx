"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { formatDateTime } from "@/lib/dates";

export function ErrorsPanel() {
  const rows = useQuery(api.admin.automationErrors);
  if (rows === undefined) return <ListSkeleton />;
  if (rows.length === 0) {
    return <EmptyState title="No automation errors" description="Workflow failures reported by n8n show up here." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workflow</TableHead>
            <TableHead>Node</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.workflowName}</TableCell>
              <TableCell>{r.nodeName ?? "-"}</TableCell>
              <TableCell className="max-w-md whitespace-normal break-words">{r.message}</TableCell>
              <TableCell>{formatDateTime(r.receivedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
