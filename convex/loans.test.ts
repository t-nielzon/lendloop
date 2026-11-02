import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { daysFromNow, setupWorld } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const invalid = { data: { code: "INVALID" } };
const forbidden = { data: { code: "FORBIDDEN" } };

describe("loan requests", () => {
  it("requires sign-in and rejects own tools and archived tools", async () => {
    const { t, owner, borrower, root, toolId } = await setupWorld();
    const dates = { toolId, startDate: daysFromNow(1), endDate: daysFromNow(2) };
    await expect(t.mutation(api.loans.request, dates)).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(owner.mutation(api.loans.request, dates)).rejects.toMatchObject(invalid);
    await root.mutation(api.tools.archive, { toolId });
    await expect(borrower.mutation(api.loans.request, dates)).rejects.toMatchObject(invalid);
  });

  it("validates dates, span and note", async () => {
    const { borrower, toolId } = await setupWorld();
    const req = (startDate: string, endDate: string, note?: string) =>
      borrower.mutation(api.loans.request, { toolId, startDate, endDate, note });
    await expect(req("2026-13-40", daysFromNow(2))).rejects.toMatchObject(invalid);
    await expect(req(daysFromNow(-1), daysFromNow(2))).rejects.toMatchObject(invalid);
    await expect(req(daysFromNow(3), daysFromNow(2))).rejects.toMatchObject(invalid);
    await expect(req(daysFromNow(1), daysFromNow(32))).rejects.toMatchObject(invalid);
    await expect(req(daysFromNow(1), daysFromNow(2), "x".repeat(501))).rejects.toMatchObject(invalid);
    await expect(req(daysFromNow(0), daysFromNow(30))).resolves.toBeDefined();
  });

  it("rejects overlap with approved loans and duplicate own requests but allows other requests", async () => {
    const { owner, borrower, other, toolId } = await setupWorld();
    const first = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(5),
    });
    await expect(
      borrower.mutation(api.loans.request, { toolId, startDate: daysFromNow(4), endDate: daysFromNow(6) }),
    ).rejects.toMatchObject(invalid);
    // a competing request from someone else is fine until one is approved
    const second = await other.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(3),
      endDate: daysFromNow(4),
    });
    await owner.mutation(api.loans.approve, { loanId: first });
    await expect(owner.mutation(api.loans.approve, { loanId: second })).rejects.toMatchObject(invalid);
    await expect(
      other.mutation(api.loans.request, { toolId, startDate: daysFromNow(5), endDate: daysFromNow(6) }),
    ).rejects.toMatchObject(invalid);
    await expect(
      other.mutation(api.loans.request, { toolId, startDate: daysFromNow(6), endDate: daysFromNow(7) }),
    ).resolves.toBeDefined();
  });
});

describe("loan transitions", () => {
  async function requested() {
    const w = await setupWorld();
    const loanId = await w.borrower.mutation(api.loans.request, {
      toolId: w.toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(3),
    });
    return { ...w, loanId };
  }

  it("approves, then marks returned, writing an event and outbox row each time", async () => {
    const { t, owner, loanId } = await requested();
    await owner.mutation(api.loans.approve, { loanId });
    await owner.mutation(api.loans.markReturned, { loanId });
    const detail = await owner.query(api.loans.get, { loanId });
    expect(detail?.status).toBe("returned");
    expect(detail?.events.map((e) => e.type)).toEqual(["requested", "approved", "returned"]);
    const rows = await t.run((ctx) => ctx.db.query("outbox").collect());
    expect(rows).toHaveLength(3);
    const approved = rows.find((r) => r.payload.loan.status === "approved")!;
    expect(approved.payload.recipient).toEqual({ firstName: "Ben", email: "ben@example.com" });
    expect(approved.payload.loan.previousStatus).toBe("requested");
    expect(approved.payload.link).toBe(`https://app.example/loans/${loanId}`);
    expect(rows.find((r) => r.payload.loan.status === "requested")!.payload.recipient.firstName).toBe("Olive");
    expect(approved.status).toBe("pending");
  });

  it("lets admins act for owners but not borrowers cancel others' loans", async () => {
    const { root, other, loanId } = await requested();
    await expect(other.mutation(api.loans.decline, { loanId })).rejects.toMatchObject(forbidden);
    await expect(root.mutation(api.loans.cancel, { loanId })).rejects.toMatchObject(forbidden);
    await root.mutation(api.loans.decline, { loanId });
  });

  it("lets only the borrower cancel and writes the owner notification", async () => {
    const { t, owner, borrower, loanId } = await requested();
    await expect(owner.mutation(api.loans.cancel, { loanId })).rejects.toMatchObject(forbidden);
    await borrower.mutation(api.loans.cancel, { loanId });
    const rows = await t.run((ctx) => ctx.db.query("outbox").collect());
    expect(rows.find((r) => r.payload.loan.status === "cancelled")!.payload.recipient.firstName).toBe("Olive");
  });

  it("rejects every disallowed transition", async () => {
    const { owner, borrower, loanId } = await requested();
    await expect(owner.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject(invalid);
    await owner.mutation(api.loans.decline, { loanId });
    await expect(owner.mutation(api.loans.approve, { loanId })).rejects.toMatchObject(invalid);
    await expect(owner.mutation(api.loans.decline, { loanId })).rejects.toMatchObject(invalid);
    await expect(borrower.mutation(api.loans.cancel, { loanId })).rejects.toMatchObject(invalid);
    await expect(owner.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject(invalid);
  });

  it("rejects cancel and decline once approved", async () => {
    const { owner, borrower, loanId } = await requested();
    await owner.mutation(api.loans.approve, { loanId });
    await expect(borrower.mutation(api.loans.cancel, { loanId })).rejects.toMatchObject(invalid);
    await expect(owner.mutation(api.loans.decline, { loanId })).rejects.toMatchObject(invalid);
  });
});

describe("loan reads", () => {
  it("restricts loans.get to participants and admins", async () => {
    const { t, root, owner, borrower, other, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(2),
    });
    await expect(t.query(api.loans.get, { loanId })).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(other.query(api.loans.get, { loanId })).rejects.toMatchObject(forbidden);
    expect((await borrower.query(api.loans.get, { loanId }))?.viewerRole).toBe("borrower");
    expect((await owner.query(api.loans.get, { loanId }))?.viewerRole).toBe("owner");
    expect((await root.query(api.loans.get, { loanId }))?.viewerRole).toBe("admin");
    expect(await root.query(api.loans.get, { loanId })).toMatchObject({ canManage: true, canCancel: false });
    expect(await borrower.query(api.loans.get, { loanId })).toMatchObject({ canManage: false, canCancel: true });
  });

  it("splits my requests and incoming and gates the admin list", async () => {
    const { owner, borrower, root, toolId } = await setupWorld();
    await borrower.mutation(api.loans.request, { toolId, startDate: daysFromNow(1), endDate: daysFromNow(2) });
    expect(await borrower.query(api.loans.listMyRequests, {})).toHaveLength(1);
    expect(await owner.query(api.loans.listMyRequests, {})).toHaveLength(0);
    expect(await owner.query(api.loans.listIncoming, {})).toHaveLength(1);
    expect(await owner.query(api.loans.listIncoming, { status: "approved" })).toHaveLength(0);
    expect(await owner.query(api.loans.listIncoming, { status: "requested" })).toHaveLength(1);
    await expect(owner.query(api.loans.listAll, {})).rejects.toMatchObject(forbidden);
    expect(await root.query(api.loans.listAll, { status: "requested" })).toHaveLength(1);
    expect(await root.query(api.loans.listAll, { overdueOnly: true })).toHaveLength(0);
  });

  it("flags approved loans past their end date as overdue", async () => {
    const { t, owner, root, borrower, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(0),
      endDate: daysFromNow(1),
    });
    await owner.mutation(api.loans.approve, { loanId });
    await t.run((ctx) => ctx.db.patch(loanId, { startDate: daysFromNow(-5), endDate: daysFromNow(-2) }));
    const overdue = await root.query(api.loans.listAll, { overdueOnly: true });
    expect(overdue.map((l) => l.id)).toEqual([loanId]);
    expect(overdue[0].isOverdue).toBe(true);
  });
});

describe("admin", () => {
  it("lists dead and pending deliveries and retries dead and pending ones", async () => {
    const { t, root, owner, borrower, toolId } = await setupWorld();
    await borrower.mutation(api.loans.request, { toolId, startDate: daysFromNow(1), endDate: daysFromNow(2) });
    await expect(owner.query(api.admin.outbox, {})).rejects.toMatchObject(forbidden);
    const rows = await root.query(api.admin.outbox, {});
    expect(rows).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(rows[0].id, { status: "delivered" }));
    await expect(root.mutation(api.admin.retryDelivery, { outboxId: rows[0].id })).rejects.toMatchObject(invalid);
    await t.run((ctx) => ctx.db.patch(rows[0].id, { status: "dead", attempts: 6 }));
    await root.mutation(api.admin.retryDelivery, { outboxId: rows[0].id });
    const after = await t.run((ctx) => ctx.db.get(rows[0].id));
    expect(after?.status).toBe("pending");
    expect(after?.attempts).toBe(0);
    await expect(owner.query(api.admin.automationErrors, {})).rejects.toMatchObject(forbidden);
    expect(await root.query(api.admin.automationErrors, {})).toEqual([]);
  });
});

describe("approval guards", () => {
  it("rejects approving a second request that overlaps an approved one", async () => {
    const { owner, borrower, other, toolId } = await setupWorld();
    const a = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(4),
    });
    const b = await other.mutation(api.loans.request, { toolId, startDate: daysFromNow(3), endDate: daysFromNow(6) });
    await owner.mutation(api.loans.approve, { loanId: a });
    await expect(owner.mutation(api.loans.approve, { loanId: b })).rejects.toMatchObject(invalid);
  });

  it("rejects approval for a start date in the past", async () => {
    const { t, owner, borrower, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(0),
      endDate: daysFromNow(2),
    });
    await t.run((ctx) => ctx.db.patch(loanId, { startDate: daysFromNow(-1) }));
    await expect(owner.mutation(api.loans.approve, { loanId })).rejects.toMatchObject(invalid);
  });

  it("archiving a tool declines its pending requests with events and notifications", async () => {
    const { t, owner, borrower, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(2),
    });
    await owner.mutation(api.tools.archive, { toolId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.status).toBe("declined");
    const events = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(events).toContainEqual(expect.objectContaining({ type: "declined", detail: "tool archived" }));
    expect((await t.run((ctx) => ctx.db.query("outbox").collect())).length).toBe(2);
  });

  it("rejects approving a request on an archived tool", async () => {
    const { t, owner, borrower, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(2),
    });
    await t.run((ctx) => ctx.db.patch(toolId, { status: "archived" }));
    await expect(owner.mutation(api.loans.approve, { loanId })).rejects.toMatchObject(invalid);
  });

  it("shows first names only in the loan view and timeline", async () => {
    const { owner, borrower, toolId } = await setupWorld();
    const loanId = await borrower.mutation(api.loans.request, {
      toolId,
      startDate: daysFromNow(1),
      endDate: daysFromNow(2),
    });
    const loan = await owner.query(api.loans.get, { loanId });
    expect(loan?.borrowerName).toBe("Ben");
    expect(loan?.ownerName).toBe("Olive");
    expect(loan?.events[0].actorName).toBe("Ben");
  });
});
