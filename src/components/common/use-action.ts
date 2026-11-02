"use client";

import { useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

// wraps a mutation call with a pending flag plus success and mapped-error toasts
export function useAction() {
  const [pending, setPending] = useState(false);

  async function run<T>(fn: () => Promise<T>, successMessage: string): Promise<T | undefined> {
    setPending(true);
    try {
      const result = await fn();
      toast.success(successMessage);
      return result;
    } catch (error) {
      toast.error(friendlyError(error));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { pending, run };
}
