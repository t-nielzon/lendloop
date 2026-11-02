import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <h3 className="font-medium">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      {message}
    </div>
  );
}

export function ForbiddenState({ message = "You don't have access to this page." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-10 text-center" role="alert">
      <Lock className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="font-medium">Access restricted</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  );
}
