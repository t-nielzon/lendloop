import { ConvexError } from "convex/values";

// a single error shape lets the client map codes to friendly messages
export const unauthenticated = () => new ConvexError({ code: "UNAUTHENTICATED" as const });
export const forbidden = () => new ConvexError({ code: "FORBIDDEN" as const });
export const invalid = (message: string) => new ConvexError({ code: "INVALID" as const, message });
