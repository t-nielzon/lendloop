import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { daysFromNow, setupWorld } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("tools", () => {
  it("hides owner fields on the public listing and shows first name when signed in", async () => {
    const { t, borrower } = await setupWorld();
    const pub = await t.query(api.tools.listPublic, {});
    expect(pub).toHaveLength(1);
    const keys = Object.keys(pub[0]);
    expect(keys).not.toContain("ownerId");
    expect(keys).not.toContain("ownerName");
    expect(JSON.stringify(pub)).not.toContain("Olive");
    const signedIn = await borrower.query(api.tools.list, {});
    expect(signedIn[0].ownerName).toBe("Olive");
    expect(signedIn[0].isMine).toBe(false);
  });

  it("requires sign-in for the authed listing and creation", async () => {
    const { t } = await setupWorld();
    await expect(t.query(api.tools.list, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(
      t.mutation(api.tools.create, { name: "x", description: "", category: "other", condition: "new" }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("validates name length", async () => {
    const { owner } = await setupWorld();
    await expect(
      owner.mutation(api.tools.create, { name: "n".repeat(81), description: "", category: "other", condition: "new" }),
    ).rejects.toMatchObject({ data: { code: "INVALID" } });
  });

  it("filters by search, category and availability", async () => {
    const { t, owner, borrower, toolId } = await setupWorld();
    await owner.mutation(api.tools.create, {
      name: "Garden rake",
      description: "",
      category: "garden",
      condition: "worn",
    });
    expect((await t.query(api.tools.listPublic, { search: "drill" })).map((x) => x.name)).toEqual(["Cordless drill"]);
    expect((await t.query(api.tools.listPublic, { category: "garden" })).map((x) => x.name)).toEqual(["Garden rake"]);

    const today = daysFromNow(0);
    const loanId = await borrower.mutation(api.loans.request, { toolId, startDate: today, endDate: daysFromNow(2) });
    await owner.mutation(api.loans.approve, { loanId });
    expect((await t.query(api.tools.listPublic, { availability: "on-loan" })).map((x) => x.name)).toEqual([
      "Cordless drill",
    ]);
    expect((await t.query(api.tools.listPublic, { availability: "available" })).map((x) => x.name)).toEqual([
      "Garden rake",
    ]);
    const drill = (await t.query(api.tools.listPublic, { search: "drill" }))[0];
    expect(drill.availableNow).toBe(false);
    expect(drill.nextFreeDate).toBe(daysFromNow(3));
  });

  it("only lets the owner or an admin edit and archive", async () => {
    const { owner, other, root, toolId, t } = await setupWorld();
    await expect(other.mutation(api.tools.update, { toolId, name: "Hacked" })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(other.mutation(api.tools.archive, { toolId })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await owner.mutation(api.tools.update, { toolId, name: "Renamed" });
    await root.mutation(api.tools.archive, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    expect(await other.query(api.tools.get, { toolId })).toBeNull();
    expect((await owner.query(api.tools.get, { toolId }))?.status).toBe("archived");
  });

  it("applies category and availability before the result limit", async () => {
    const { t, owner, borrower, other } = await setupWorld();
    // the rake is the oldest row; 210 newer tools of another category must not push it out of a category filter
    await owner.mutation(api.tools.create, {
      name: "Garden rake",
      description: "",
      category: "garden",
      condition: "good",
    });
    for (let i = 0; i < 210; i++) {
      await owner.mutation(api.tools.create, {
        name: `Ladder ${i}`,
        description: "",
        category: "outdoor",
        condition: "good",
      });
    }
    expect((await t.query(api.tools.listPublic, { category: "garden" })).map((x) => x.name)).toEqual(["Garden rake"]);
    const ladders = await t.query(api.tools.listPublic, { category: "outdoor" });
    expect(ladders).toHaveLength(100);

    const rakeId = (await t.query(api.tools.listPublic, { category: "garden" }))[0].id;
    const loanId = await borrower.mutation(api.loans.request, {
      toolId: rakeId,
      startDate: daysFromNow(0),
      endDate: daysFromNow(1),
    });
    await owner.mutation(api.loans.approve, { loanId });
    expect((await t.query(api.tools.listPublic, { availability: "on-loan" })).map((x) => x.name)).toEqual([
      "Garden rake",
    ]);
    void other;
  });

  it("returns null for malformed or foreign-table ids instead of throwing", async () => {
    const { owner, toolId } = await setupWorld();
    expect(await owner.query(api.tools.get, { toolId: "abc" })).toBeNull();
    expect(await owner.query(api.loans.get, { loanId: "abc" })).toBeNull();
    expect(await owner.query(api.loans.get, { loanId: toolId })).toBeNull();
  });

  it("hides borrower identity in booked ranges from non-owners", async () => {
    const { owner, borrower, other, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(2),
    });
    await owner.mutation(api.loans.approve, { loanId });
    const asOther = await other.query(api.tools.get, { toolId });
    expect(asOther?.bookedRanges).toEqual([
      { startDate: daysFromNow(1), endDate: daysFromNow(2), loanId: undefined, borrowerName: undefined },
    ]);
    const asOwner = await owner.query(api.tools.get, { toolId });
    expect(asOwner?.bookedRanges[0].borrowerName).toBe("Ben");
  });
});
