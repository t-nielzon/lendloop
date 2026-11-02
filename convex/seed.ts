import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { invalid } from "./lib/errors";
import { isAutomationEvent } from "./lib/loanEvents";

// dev-only helpers: internal functions are unreachable from clients, so they can only be run through the cli

const DEMO_OWNER_TOKEN = "seed|demo-owner";

const DEMO_TOOLS = [
  { name: "Cordless drill", description: "18v with two batteries and a case", category: "power-tools", condition: "good" },
  { name: "Extension ladder", description: "Aluminium, extends to 4 m", category: "hand-tools", condition: "worn" },
  { name: "Hedge trimmer", description: "Electric, 55 cm blade", category: "garden", condition: "good" },
  { name: "Stand mixer", description: "5 litre bowl with dough hook", category: "kitchen", condition: "new" },
  { name: "Two-person tent", description: "Three season, easy pitch", category: "outdoor", condition: "good" },
] as const;

export const demoTools = internalMutation({
  args: {},
  handler: async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", DEMO_OWNER_TOKEN))
      .unique();
    const now = Date.now();
    const ownerId =
      owner?._id ??
      (await ctx.db.insert("users", {
        tokenIdentifier: DEMO_OWNER_TOKEN,
        name: "Demo Neighbour",
        email: "demo-neighbour@example.com",
        role: "user",
        createdAt: now,
      }));

    const existing = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(100);
    const have = new Set(existing.map((t) => t.name));
    let created = 0;
    for (const t of DEMO_TOOLS) {
      if (have.has(t.name)) continue;
      await ctx.db.insert("tools", { ...t, ownerId, status: "active", createdAt: now, updatedAt: now });
      created++;
    }
    return { created };
  },
});

// ---- richer neighbourhood seed ----
// seed identities use a reserved email domain and a token prefix no identity provider can issue, so no real person can be emailed or matched

const SEED_PREFIX = "seed|";

type Category = Doc<"tools">["category"];
type Condition = Doc<"tools">["condition"];

const SEED_USERS = [
  { slug: "maya", name: "Maya Santos" },
  { slug: "daniel", name: "Daniel Okafor" },
  { slug: "priya", name: "Priya Raman" },
  { slug: "tom", name: "Tom Whitfield" },
  { slug: "aiko", name: "Aiko Tanaka" },
  { slug: "luis", name: "Luis Moreno" },
  { slug: "grace", name: "Grace O'Neill" },
  { slug: "samuel", name: "Samuel Mensah" },
  { slug: "hannah", name: "Hannah Kowalski" },
  { slug: "omar", name: "Omar Haddad" },
] as const;

type Slug = (typeof SEED_USERS)[number]["slug"];

type SeedTool = {
  key: string;
  owner: Slug;
  name: string;
  description: string;
  category: Category;
  condition: Condition;
  archived?: boolean;
};

const SEED_TOOLS: SeedTool[] = [
  { key: "drill", owner: "tom", name: "Cordless drill driver, 18 V", description: "Two 2 Ah batteries, charger and a 30-piece bit set in a carry case. Keep the batteries off the charger once full.", category: "power-tools", condition: "good" },
  { key: "jigsaw", owner: "daniel", name: "Corded jigsaw", description: "710 W with variable speed and a dust port. Comes with five wood blades and two metal blades.", category: "power-tools", condition: "good" },
  { key: "circsaw", owner: "luis", name: "Circular saw, 190 mm", description: "Cuts up to 65 mm deep, with a rip fence and a spare blade. Blade guard sticks a little, so check it before each cut.", category: "power-tools", condition: "worn" },
  { key: "pressure", owner: "samuel", name: "Pressure washer, 1800 W", description: "Good for patios and cars. Includes a 5 m hose, a patio cleaner attachment and a lance; bring your own garden hose adapter.", category: "power-tools", condition: "good" },
  { key: "sander", owner: "tom", name: "Random orbital sander", description: "125 mm pad with a dust bag. Hook-and-loop discs in three grits are included.", category: "power-tools", condition: "new" },
  { key: "ladder", owner: "grace", name: "Aluminium extension ladder", description: "Extends to 4 m and folds to 2.4 m. Rubber feet are worn, so please use it on firm ground only.", category: "hand-tools", condition: "worn" },
  { key: "sockets", owner: "daniel", name: "Socket and spanner set, 94 piece", description: "Metric and imperial sockets with a ratchet, extension bars and combination spanners in a blow-moulded case.", category: "hand-tools", condition: "new" },
  { key: "tilecutter", owner: "hannah", name: "Manual tile cutter, 600 mm", description: "Scores and snaps ceramic tiles up to 600 mm. Spare scoring wheel included; wipe the rail clean after use.", category: "hand-tools", condition: "good" },
  { key: "wrenches", owner: "omar", name: "Pipe wrench set, 14 and 18 inch", description: "Two heavy cast wrenches, handy for plumbing jobs. Jaws are a bit worn but still grip well.", category: "hand-tools", condition: "worn" },
  { key: "clamps", owner: "luis", name: "Bar clamp set, 4 x 600 mm", description: "Four quick-release clamps with soft pads to protect the wood. Great for glue-ups.", category: "hand-tools", condition: "good" },
  { key: "hedge", owner: "priya", name: "Electric hedge trimmer, 55 cm", description: "Corded with a 10 m orange extension lead included. Blade cover and a small bottle of blade oil come with it.", category: "garden", condition: "good" },
  { key: "mower", owner: "grace", name: "Cordless lawn mower", description: "36 cm cut with a 40 L collection box and one battery, which does roughly 250 square metres per charge.", category: "garden", condition: "good" },
  { key: "wheelbarrow", owner: "samuel", name: "Wheelbarrow, 100 litre", description: "Galvanised tray and a pneumatic tyre that holds pressure well. The handle grips are a little cracked.", category: "garden", condition: "worn" },
  { key: "tiller", owner: "omar", name: "Garden cultivator, 600 W", description: "Electric tiller that breaks up soil to about 20 cm deep. Please brush off the tines after use.", category: "garden", condition: "good" },
  { key: "blower", owner: "aiko", name: "Leaf blower and vacuum", description: "Corded 2500 W unit with a 45 L collection bag. Switches between blow and vacuum without tools.", category: "garden", condition: "good" },
  { key: "mixer", owner: "maya", name: "Stand mixer, 5 litre", description: "Tilt-head mixer with a dough hook, whisk and flat beater. Wash the bowl by hand, please.", category: "kitchen", condition: "new" },
  { key: "pasta", owner: "aiko", name: "Pasta machine with cutters", description: "Hand-crank roller with seven thickness settings plus spaghetti and tagliatelle cutters. Dust with flour rather than washing it.", category: "kitchen", condition: "good" },
  { key: "cooker", owner: "priya", name: "Pressure cooker, 6 litre", description: "Stainless steel stovetop model with a spare sealing ring and a steamer basket.", category: "kitchen", condition: "good" },
  { key: "dehydrator", owner: "hannah", name: "Food dehydrator, 5 trays", description: "Adjustable thermostat from 35 to 70 degrees. Trays are dishwasher safe.", category: "kitchen", condition: "good", archived: true },
  { key: "tent", owner: "maya", name: "Two-person tent", description: "Three-season dome tent with a footprint groundsheet, pegs and a repair kit. Pitches in about ten minutes.", category: "outdoor", condition: "good" },
  { key: "bbq", owner: "tom", name: "Portable gas barbecue", description: "Tabletop grill with a regulator, a fold-away stand and a carry bag. Gas bottle not included.", category: "outdoor", condition: "good" },
  { key: "kayak", owner: "daniel", name: "Inflatable kayak, two-person", description: "Comes with two paddles, a foot pump and a dry bag. Please rinse and dry it fully before returning.", category: "outdoor", condition: "good" },
  { key: "campset", owner: "grace", name: "Folding camping table and four chairs", description: "Aluminium roll-top table with four padded chairs, all packed in a single carry bag.", category: "outdoor", condition: "good" },
  { key: "projector", owner: "samuel", name: "Portable 1080p projector", description: "HDMI and USB inputs with a small tripod and a 100 inch pull-down screen. Works best after dusk.", category: "electronics", condition: "good" },
  { key: "solder", owner: "aiko", name: "Soldering station", description: "Temperature-controlled iron with a stand, spare tips, solder and a helping-hands clip.", category: "electronics", condition: "good" },
  { key: "multimeter", owner: "omar", name: "Digital multimeter", description: "Measures voltage, current, resistance and continuity, with spare probes and a padded case.", category: "electronics", condition: "new" },
  { key: "carpet", owner: "priya", name: "Carpet cleaner", description: "Upright deep cleaner with a hand tool for stairs. Return it with empty tanks and a rinsed brush roll.", category: "other", condition: "worn" },
  { key: "stripper", owner: "luis", name: "Steam wallpaper stripper", description: "Plate steamer with a 4 m hose and a 3 litre tank. Needs about ten minutes to heat up.", category: "other", condition: "worn", archived: true },
];

type SeedLoan = {
  tool: string;
  borrower: Slug;
  // day offsets from today (utc); the end day is inclusive
  start: number;
  end: number;
  status: Doc<"loans">["status"];
  note?: string;
  // hours ago the request was made; defaults to three days before the start
  requestedHoursAgo?: number;
  // day offsets of overdue reminders already sent
  reminders?: number[];
  reason?: string;
};

const SEED_LOANS: SeedLoan[] = [
  // requested, some competing for the same tool
  { tool: "mixer", borrower: "tom", start: 3, end: 5, status: "requested", note: "Baking for my daughter's party, thank you!", requestedHoursAgo: 20 },
  { tool: "mixer", borrower: "luis", start: 4, end: 6, status: "requested", note: "Making bread for the street picnic.", requestedHoursAgo: 8 },
  { tool: "tent", borrower: "hannah", start: 9, end: 12, status: "requested", note: "Weekend away with the kids.", requestedHoursAgo: 30 },
  { tool: "drill", borrower: "priya", start: 2, end: 3, status: "requested", note: "Putting up shelves.", requestedHoursAgo: 5 },
  { tool: "drill", borrower: "omar", start: 3, end: 4, status: "requested", requestedHoursAgo: 3 },
  { tool: "drill", borrower: "aiko", start: 3, end: 3, status: "requested", note: "Only need it for one afternoon.", requestedHoursAgo: 2 },
  { tool: "kayak", borrower: "grace", start: 6, end: 8, status: "requested", note: "Hoping to try the river on Saturday.", requestedHoursAgo: 50 },
  { tool: "projector", borrower: "maya", start: 1, end: 1, status: "requested", note: "Film night with the neighbours.", requestedHoursAgo: 12 },
  { tool: "pressure", borrower: "luis", start: 5, end: 6, status: "requested", requestedHoursAgo: 26 },
  { tool: "ladder", borrower: "omar", start: 7, end: 8, status: "requested", note: "Clearing the gutters.", requestedHoursAgo: 4 },
  { tool: "carpet", borrower: "hannah", start: 2, end: 3, status: "requested", requestedHoursAgo: 6 },
  // approved and running now
  { tool: "circsaw", borrower: "daniel", start: -1, end: 2, status: "approved", note: "Building a raised bed." },
  { tool: "tiller", borrower: "hannah", start: -2, end: 1, status: "approved", note: "Prepping the allotment." },
  { tool: "bbq", borrower: "samuel", start: 0, end: 1, status: "approved", requestedHoursAgo: 40 },
  { tool: "pasta", borrower: "priya", start: -1, end: 1, status: "approved", note: "Pasta night!" },
  // approved and upcoming
  { tool: "hedge", borrower: "grace", start: 2, end: 4, status: "approved", requestedHoursAgo: 60 },
  { tool: "tent", borrower: "omar", start: 4, end: 6, status: "approved", note: "Scout camp over the weekend.", requestedHoursAgo: 70 },
  { tool: "tilecutter", borrower: "tom", start: 6, end: 9, status: "approved", note: "Retiling the bathroom floor.", requestedHoursAgo: 55 },
  { tool: "sockets", borrower: "aiko", start: 3, end: 5, status: "approved", requestedHoursAgo: 48 },
  { tool: "kayak", borrower: "priya", start: 14, end: 16, status: "approved", requestedHoursAgo: 90 },
  // approved and starting tomorrow, a pickup reminder candidate
  { tool: "mixer", borrower: "grace", start: 1, end: 2, status: "approved", note: "Cake for the school fair.", requestedHoursAgo: 52 },
  // approved and overdue, with reminders sent
  { tool: "ladder", borrower: "samuel", start: -9, end: -3, status: "approved", note: "Painting the back fence.", reminders: [-1, 0] },
  { tool: "wheelbarrow", borrower: "maya", start: -6, end: -2, status: "approved", reminders: [-1] },
  // returned
  { tool: "mower", borrower: "hannah", start: -20, end: -17, status: "returned" },
  { tool: "drill", borrower: "daniel", start: -12, end: -10, status: "returned", note: "Fixing the gate." },
  { tool: "pasta", borrower: "maya", start: -15, end: -14, status: "returned" },
  { tool: "blower", borrower: "luis", start: -8, end: -6, status: "returned", note: "Autumn leaves everywhere." },
  { tool: "multimeter", borrower: "aiko", start: -30, end: -28, status: "returned" },
  { tool: "projector", borrower: "hannah", start: -18, end: -17, status: "returned" },
  { tool: "cooker", borrower: "omar", start: -5, end: -3, status: "returned", note: "Slow-cooked stew for the whole family." },
  { tool: "clamps", borrower: "tom", start: -25, end: -22, status: "returned" },
  { tool: "stripper", borrower: "omar", start: -40, end: -37, status: "returned" },
  // expired: the start date passed with no decision
  { tool: "pressure", borrower: "tom", start: -3, end: -2, status: "expired", requestedHoursAgo: 120 },
  // declined and cancelled
  { tool: "circsaw", borrower: "omar", start: -4, end: -2, status: "declined", reason: "Sorry, I needed it myself that week." },
  { tool: "mower", borrower: "priya", start: 10, end: 11, status: "declined", reason: "I'm away that weekend, sorry!" },
  { tool: "kayak", borrower: "hannah", start: 20, end: 22, status: "cancelled", requestedHoursAgo: 100 },
  { tool: "bbq", borrower: "luis", start: 11, end: 12, status: "cancelled", note: "Garden party.", requestedHoursAgo: 80 },
];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function dayString(dayStart: number, offset: number): string {
  return new Date(dayStart + offset * DAY_MS).toISOString().slice(0, 10);
}

type EventDraft = Omit<Doc<"loanEvents">, "_id" | "_creationTime" | "loanId">;

// builds the timeline for one loan; every timestamp is kept in the past and in order
function buildLoan(l: SeedLoan, now: number, dayStart: number, ownerId: Id<"users">, borrowerId: Id<"users">) {
  const startMs = dayStart + l.start * DAY_MS;
  const endMs = dayStart + l.end * DAY_MS;
  const requestedAt = l.requestedHoursAgo !== undefined ? now - l.requestedHoursAgo * HOUR_MS : Math.min(startMs - 3 * DAY_MS, now - 6 * HOUR_MS);
  const decidedAt = requestedAt + Math.min(4 * HOUR_MS, Math.floor((now - requestedAt) / 2));
  const events: EventDraft[] = [];
  const delivered = (at: number): EventDraft => ({ at: at + 60_000, actorType: "system", type: "notification_delivered" });

  events.push({ at: requestedAt, actorType: "user", actorId: borrowerId, type: "requested", detail: l.note }, delivered(requestedAt));

  const loan: Omit<Doc<"loans">, "_id" | "_creationTime" | "toolId"> = {
    ownerId,
    borrowerId,
    startDate: dayString(dayStart, l.start),
    endDate: dayString(dayStart, l.end),
    note: l.note,
    status: l.status,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    reminderCount: 0,
  };

  if (l.status === "approved" || l.status === "returned" || l.status === "declined") {
    const type = l.status === "declined" ? "declined" : "approved";
    events.push({ at: decidedAt, actorType: "user", actorId: ownerId, type, detail: l.reason }, delivered(decidedAt));
    loan.decidedAt = decidedAt;
    loan.updatedAt = decidedAt;
  }
  if (l.status === "expired") {
    const expiredAt = Math.min(startMs + 10 * HOUR_MS, now - 60_000);
    events.push({ at: expiredAt, actorType: "automation", type: "expired", detail: "no decision before the start date" }, delivered(expiredAt));
    loan.updatedAt = expiredAt;
  }
  if (l.status === "cancelled") {
    events.push({ at: decidedAt, actorType: "user", actorId: borrowerId, type: "cancelled" }, delivered(decidedAt));
    loan.updatedAt = decidedAt;
  }
  if (l.status === "returned") {
    const returnedAt = Math.min(endMs + 12 * HOUR_MS, now - 5 * 60_000);
    events.push({ at: returnedAt, actorType: "user", actorId: ownerId, type: "returned" }, delivered(returnedAt));
    loan.returnedAt = returnedAt;
    loan.updatedAt = returnedAt;
  }
  if (l.reminders?.length) {
    for (const offset of l.reminders) {
      const at = Math.min(dayStart + offset * DAY_MS + 8 * HOUR_MS, now - 60_000);
      events.push({ at, actorType: "automation", type: "reminder_sent", detail: `overdue reminder for ${dayString(dayStart, offset)}` });
    }
    loan.reminderCount = l.reminders.length;
    loan.lastReminderOn = dayString(dayStart, l.reminders[l.reminders.length - 1]);
    loan.updatedAt = events[events.length - 1].at;
  }
  events.sort((a, b) => a.at - b.at);
  // mirrors what the mutations denormalize so the seeded list rows show the same latest automation line
  const latest = events.filter((e) => isAutomationEvent(e.type)).at(-1);
  if (latest) {
    loan.lastAutomationAt = latest.at;
    loan.lastAutomationType = latest.type;
  }
  return { loan, events };
}

// writes documents directly: seeding must never queue outbox rows or schedule deliveries
async function insertDemo(ctx: MutationCtx) {
  const now = Date.now();
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const userIds = new Map<string, Id<"users">>();
  for (const [i, u] of SEED_USERS.entries()) {
    const id = await ctx.db.insert("users", {
      tokenIdentifier: `${SEED_PREFIX}${u.slug}`,
      name: u.name,
      email: `${u.slug}.seed@example.com`,
      role: "user",
      createdAt: now - (60 + i * 5) * DAY_MS,
    });
    userIds.set(u.slug, id);
  }
  const toolIds = new Map<string, { id: Id<"tools">; owner: Slug }>();
  for (const [i, t] of SEED_TOOLS.entries()) {
    const createdAt = now - (50 - i) * DAY_MS;
    const id = await ctx.db.insert("tools", {
      ownerId: userIds.get(t.owner)!,
      name: t.name,
      description: t.description,
      category: t.category,
      condition: t.condition,
      status: t.archived ? "archived" : "active",
      createdAt,
      updatedAt: createdAt,
    });
    toolIds.set(t.key, { id, owner: t.owner });
  }
  for (const l of SEED_LOANS) {
    const tool = toolIds.get(l.tool)!;
    const { loan, events } = buildLoan(l, now, dayStart, userIds.get(tool.owner)!, userIds.get(l.borrower)!);
    const loanId = await ctx.db.insert("loans", { ...loan, toolId: tool.id });
    for (const e of events) await ctx.db.insert("loanEvents", { ...e, loanId });
  }
  return { users: SEED_USERS.length, tools: SEED_TOOLS.length, loans: SEED_LOANS.length };
}

async function seedUsers(ctx: MutationCtx) {
  const all = await ctx.db.query("users").collect();
  return all.filter((u) => u.tokenIdentifier.startsWith(SEED_PREFIX));
}

async function deleteLoan(ctx: MutationCtx, loanId: Id<"loans">) {
  const events = await ctx.db.query("loanEvents").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect();
  for (const e of events) await ctx.db.delete(e._id);
  const outbox = await ctx.db.query("outbox").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect();
  for (const o of outbox) await ctx.db.delete(o._id);
  await ctx.db.delete(loanId);
}

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await seedUsers(ctx)).some((u) => u.tokenIdentifier !== DEMO_OWNER_TOKEN)) return { seeded: false };
    return { seeded: true, ...(await insertDemo(ctx)) };
  },
});

// removes only seed-owned data (including the older placeholder owner), then reseeds
export const resetDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await seedUsers(ctx);
    const seedIds = new Set(users.map((u) => u._id));
    const loanIds = new Set<Id<"loans">>();
    for (const u of users) {
      const tools = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", u._id)).collect();
      for (const t of tools) {
        const onTool = await ctx.db.query("loans").withIndex("by_tool_status", (q) => q.eq("toolId", t._id)).collect();
        for (const l of onTool) loanIds.add(l._id);
        await ctx.db.delete(t._id);
      }
      const asBorrower = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", u._id)).collect();
      for (const l of asBorrower) loanIds.add(l._id);
    }
    for (const id of loanIds) await deleteLoan(ctx, id);
    for (const id of seedIds) await ctx.db.delete(id);
    return { removedLoans: loanIds.size, removedUsers: seedIds.size, ...(await insertDemo(ctx)) };
  },
});

// pushes an approved loan into the past so the overdue reminder flow can be exercised
export const backdateLoan = internalMutation({
  args: { loanId: v.id("loans"), endDate: v.string() },
  handler: async (ctx, { loanId, endDate }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) throw invalid("loan not found");
    if (loan.status !== "approved") throw invalid("only approved loans can be backdated");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw invalid("endDate must be YYYY-MM-DD");
    const startDate = loan.startDate > endDate ? endDate : loan.startDate;
    await ctx.db.patch(loanId, { startDate, endDate, lastReminderOn: undefined, updatedAt: Date.now() });
    return null;
  },
});

// makes a requested loan look old so the follow-up and expiry flows can be exercised without waiting
export const ageRequest = internalMutation({
  args: { loanId: v.id("loans"), hoursOld: v.number(), startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, { loanId, hoursOld, startDate, endDate }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) throw invalid("loan not found");
    if (loan.status !== "requested") throw invalid("only requested loans can be aged");
    for (const d of [startDate, endDate]) {
      if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw invalid("dates must be YYYY-MM-DD");
    }
    const patch: Partial<Doc<"loans">> = { createdAt: Date.now() - hoursOld * 3_600_000 };
    if (startDate) patch.startDate = startDate;
    if (endDate) patch.endDate = endDate;
    await ctx.db.patch(loanId, patch);
    return null;
  },
});

// inserts a dead outbox row marked as a dev incident so the health monitor has something to report
export const createDevIncident = internalMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const now = Date.now();
    return await ctx.db.insert("outbox", {
      eventId: `dev-incident-${now}`,
      loanId,
      payload: {},
      status: "dead",
      attempts: 5,
      nextAttemptAt: now,
      lastError: "smtp connection refused (simulated outage)",
      createdAt: now,
    });
  },
});

export const clearDevIncidents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("outbox").withIndex("by_status", (q) => q.eq("status", "dead")).collect();
    const mine = rows.filter((r) => r.eventId.startsWith("dev-incident-"));
    for (const r of mine) await ctx.db.delete(r._id);
    return { removed: mine.length };
  },
});
