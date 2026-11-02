import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

describe("formatRelativeTime", () => {
  it("handles the just-now window", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW + 30_000, NOW)).toBe("just now");
  });
  it("formats minutes, hours, yesterday and days", () => {
    expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe("5 min ago");
    expect(formatRelativeTime(NOW - 3 * H, NOW)).toBe("3 h ago");
    expect(formatRelativeTime(NOW - 30 * H, NOW)).toBe("yesterday");
    expect(formatRelativeTime(NOW - 2 * D, NOW)).toBe("2 days ago");
    expect(formatRelativeTime(NOW - 10 * D - H, NOW)).toBe("10 days ago");
  });
  it("formats future dates", () => {
    expect(formatRelativeTime(NOW + 5 * MIN, NOW)).toBe("in 5 min");
    expect(formatRelativeTime(NOW + 3 * H, NOW)).toBe("in 3 h");
    expect(formatRelativeTime(NOW + 30 * H, NOW)).toBe("tomorrow");
    expect(formatRelativeTime(NOW + 3 * D, NOW)).toBe("in 3 days");
  });
  it("falls back to a date for old timestamps", () => {
    expect(formatRelativeTime(NOW - 90 * D, NOW)).toMatch(/\d{4}$/);
  });
});
