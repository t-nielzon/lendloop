import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

export const IN_SECRET = "inbound-secret-for-tests";
export const OUT_SECRET = "outbound-secret-for-tests";

export function identityFor(key: string) {
  return { subject: key, issuer: "https://test.example", name: `${key[0].toUpperCase()}${key.slice(1)} Tester`, email: `${key}@example.com` };
}

export async function setupWorld() {
  vi.stubEnv("ADMIN_EMAILS", "root@example.com");
  vi.stubEnv("APP_URL", "https://app.example");
  const t = convexTest(schema, modules);
  const as = (key: string) => t.withIdentity(identityFor(key));
  const root = as("root");
  const owner = as("olive");
  const borrower = as("ben");
  const other = as("carl");
  for (const c of [root, owner, borrower, other]) await c.mutation(api.users.store, {});
  const toolId = await owner.mutation(api.tools.create, {
    name: "Cordless drill",
    description: "18v with two batteries",
    category: "power-tools",
    condition: "good",
  });
  return { t, as, root, owner, borrower, other, toolId };
}

export function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}
