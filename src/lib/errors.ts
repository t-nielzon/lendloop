import { ConvexError } from "convex/values";

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  INVALID: "Some of the details look wrong. Please check and try again.",
};

export function errorCode(error: unknown): string | null {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    if (typeof data === "string") return data;
  }
  return null;
}

// backend may attach a human message to INVALID; prefer it since it is specific (e.g. date overlap)
export function friendlyError(error: unknown): string {
  const code = errorCode(error);
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
  if (code && MESSAGES[code]) return MESSAGES[code];
  return "Something went wrong. Please try again.";
}
