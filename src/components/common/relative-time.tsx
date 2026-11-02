"use client";

import { formatDateTime } from "@/lib/dates";
import { formatRelativeTime } from "@/lib/relative-time";
import { useNow } from "./use-now";

// <time> with the exact timestamp in title so hover and assistive tech both get it
export function RelativeTime({ at, className }: { at: number; className?: string }) {
  const now = useNow();
  return (
    <time dateTime={new Date(at).toISOString()} title={formatDateTime(at)} className={className}>
      {formatRelativeTime(at, now)}
    </time>
  );
}
