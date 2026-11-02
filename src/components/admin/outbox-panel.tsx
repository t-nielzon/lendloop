"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { useAction } from "@/components/common/use-action";
import { formatDateTime } from "@/lib/dates";

function RetryButton({ outboxId }: { outboxId: Id<"outbox"> }) {
  const retry = useMutation(api.admin.retryDelivery);
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => run(() => retry({ outboxId }), "Delivery queued for retry.")}
    >
      {pending ? "Retrying..." : "Retry"}
    </Button>
  );
}

export function OutboxPanel() {
  const rows = useQuery(api.admin.outbox);
  if (rows === undefined) return <ListSkeleton />;
  if (rows.length === 0) {
    return <EmptyState title="Nothing waiting" description="Pending and failed deliveries appear here." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Loan</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Last error</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Badge variant={r.status === "dead" ? "destructive" : "secondary"}>{r.status}</Badge>
              </TableCell>
              <TableCell>
                <Link href={`/loans/${r.loanId}`} className="hover:underline">
                  {r.loanStatus ?? "view"}
                </Link>
              </TableCell>
              <TableCell>{r.attempts}</TableCell>
              <TableCell className="max-w-xs truncate">{r.lastError ?? "-"}</TableCell>
              <TableCell>{formatDateTime(r.createdAt)}</TableCell>
              <TableCell className="text-right">
                {r.status === "dead" ? <RetryButton outboxId={r.id} /> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
