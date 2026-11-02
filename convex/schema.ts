import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const role = v.union(v.literal("admin"), v.literal("user"));

export const toolCategory = v.union(
  v.literal("power-tools"),
  v.literal("hand-tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("outdoor"),
  v.literal("electronics"),
  v.literal("other"),
);

export const toolCondition = v.union(
  v.literal("new"),
  v.literal("good"),
  v.literal("worn"),
);

export const toolStatus = v.union(v.literal("active"), v.literal("archived"));

export const loanStatus = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const loanEventType = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
  v.literal("notification_delivered"),
  v.literal("notification_failed"),
  v.literal("reminder_sent"),
);

export const actorType = v.union(
  v.literal("user"),
  v.literal("automation"),
  v.literal("system"),
);

export const outboxStatus = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("dead"),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    role,
    createdAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    description: v.string(),
    category: toolCategory,
    condition: toolCondition,
    status: toolStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["status", "category"],
    }),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
    status: loanStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    lastReminderOn: v.optional(v.string()),
    reminderCount: v.number(),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status_endDate", ["status", "endDate"]),

  loanEvents: defineTable({
    loanId: v.id("loans"),
    at: v.number(),
    actorType,
    actorId: v.optional(v.id("users")),
    type: loanEventType,
    detail: v.optional(v.string()),
  }).index("by_loan", ["loanId"]),

  outbox: defineTable({
    eventId: v.string(),
    loanId: v.id("loans"),
    payload: v.any(),
    status: outboxStatus,
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_loan", ["loanId"]),

  webhookReceipts: defineTable({
    idempotencyKey: v.string(),
    kind: v.string(),
    loanId: v.optional(v.id("loans")),
    receivedAt: v.number(),
  }).index("by_key", ["idempotencyKey"]),

  automationErrors: defineTable({
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    executionId: v.optional(v.string()),
    message: v.string(),
    receivedAt: v.number(),
    idempotencyKey: v.string(),
  }).index("by_received", ["receivedAt"]),
});
