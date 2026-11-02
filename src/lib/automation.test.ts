import { describe, expect, it } from "vitest";
import { automationLabel } from "./automation";

describe("automationLabel", () => {
  it("maps every automation event type", () => {
    expect(automationLabel("notification_delivered")).toBe("Notification sent");
    expect(automationLabel("notification_failed")).toBe("Notification failed");
    expect(automationLabel("reminder_sent")).toBe("Overdue reminder sent");
    expect(automationLabel("pickup_reminder_sent")).toBe("Pickup reminder sent");
    expect(automationLabel("request_nudged")).toBe("Owner nudged");
    expect(automationLabel("expired")).toBe("Request expired");
  });
  it("falls back to the raw type", () => {
    expect(automationLabel("mystery")).toBe("mystery");
  });
});
