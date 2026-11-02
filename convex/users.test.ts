import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

describe("users", () => {
  it("returns null for anonymous viewers", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  it("stores the viewer as a regular user by default", async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity({ name: "Alice Doe", email: "alice@example.com" });
    await asAlice.mutation(api.users.store, {});
    const me = await asAlice.query(api.users.me, {});
    expect(me?.role).toBe("user");
  });
});
