import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { setupWorld } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("users", () => {
  it("returns null for anonymous viewers", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  it("rejects store without identity", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.users.store, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("makes allowlisted emails admin and everyone else a user", async () => {
    const { root, owner } = await setupWorld();
    expect((await root.query(api.users.me, {}))?.role).toBe("admin");
    expect((await owner.query(api.users.me, {}))?.role).toBe("user");
  });

  it("keeps the role when the same user signs in again", async () => {
    const { root, owner } = await setupWorld();
    const ownerId = (await owner.query(api.users.me, {}))!._id;
    await root.mutation(api.users.setRole, { userId: ownerId, role: "admin" });
    await owner.mutation(api.users.store, {});
    expect((await owner.query(api.users.me, {}))?.role).toBe("admin");
  });

  it("lets admins list users and change roles but not their own", async () => {
    const { root, owner } = await setupWorld();
    const me = (await root.query(api.users.me, {}))!;
    expect((await root.query(api.users.list, {})).length).toBe(4);
    await expect(root.mutation(api.users.setRole, { userId: me._id, role: "user" })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(owner.query(api.users.list, {})).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(owner.mutation(api.users.setRole, { userId: me._id, role: "user" })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });
});
