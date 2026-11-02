"use client";

import { useEffect } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

// upserts the viewer once per authenticated session so convex has a users row before any role check
export function StoreUser() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);

  useEffect(() => {
    if (!isAuthenticated) return;
    void store().catch(() => {
      // a failed upsert is retried on the next sign-in; the ui must not crash on it
    });
  }, [isAuthenticated, store]);

  return null;
}
