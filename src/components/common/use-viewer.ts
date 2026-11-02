"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

// authed queries must wait for the users row: right after first sign-in the store mutation has not
// landed yet, and a query that calls requireUser would throw instead of waiting
export function useViewer() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && !viewer)) return { status: "loading" as const, viewer: null };
  if (!isAuthenticated || !viewer) return { status: "anonymous" as const, viewer: null };
  return { status: "ready" as const, viewer };
}
