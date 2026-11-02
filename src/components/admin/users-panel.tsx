"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ListSkeleton } from "@/components/common/states";
import { useAction } from "@/components/common/use-action";
import { formatDateTime } from "@/lib/dates";

function RoleSelect({ userId, role, isSelf }: { userId: Id<"users">; role: string; isSelf: boolean }) {
  const setRole = useMutation(api.users.setRole);
  const { pending, run } = useAction();
  return (
    <Select
      value={role}
      // backend rejects self changes to protect the last admin, so the control is disabled up front
      disabled={pending || isSelf}
      onValueChange={(next) =>
        run(() => setRole({ userId, role: next as "admin" | "user" }), "Role updated.")
      }
    >
      <SelectTrigger className="w-28" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">User</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function UsersPanel() {
  const users = useQuery(api.users.list);
  const me = useQuery(api.users.me);
  if (users === undefined) return <ListSkeleton />;
  if (users.length === 0) return <EmptyState title="No users yet" />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{formatDateTime(u.createdAt)}</TableCell>
              <TableCell>
                <RoleSelect userId={u.id} role={u.role} isSelf={me?._id === u.id} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
