import { describe, expect, it } from "vitest";
import { constantTimeEqual, sign, signatureHeader, verify } from "./lib/signing";

const secret = "s3cret";
const body = '{"hello":"world"}';
const now = 1_800_000_000_000;
const ts = String(now / 1000);

describe("signing", () => {
  it("produces a stable hex digest", async () => {
    const a = await sign(secret, ts, body);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sign(secret, ts, body)).toBe(a);
  });

  it("verifies a valid signature header", async () => {
    const header = await signatureHeader(secret, ts, body);
    expect(await verify(secret, ts, body, header, { now: () => now })).toBe(true);
  });

  it("rejects a tampered body, wrong secret and malformed headers", async () => {
    const header = await signatureHeader(secret, ts, body);
    expect(await verify(secret, ts, body + " ", header, { now: () => now })).toBe(false);
    expect(await verify("other", ts, body, header, { now: () => now })).toBe(false);
    expect(await verify(secret, ts, body, header.replace("v1=", "v2="), { now: () => now })).toBe(false);
    expect(await verify(secret, ts, body, null, { now: () => now })).toBe(false);
    expect(await verify(secret, null, body, header, { now: () => now })).toBe(false);
    expect(await verify("", ts, body, header, { now: () => now })).toBe(false);
  });

  it("enforces the freshness window in both directions", async () => {
    const header = await signatureHeader(secret, ts, body);
    expect(await verify(secret, ts, body, header, { now: () => now + 299_000 })).toBe(true);
    expect(await verify(secret, ts, body, header, { now: () => now + 301_000 })).toBe(false);
    expect(await verify(secret, ts, body, header, { now: () => now - 301_000 })).toBe(false);
  });

  it("does not accept a signature for a different timestamp", async () => {
    const header = await signatureHeader(secret, ts, body);
    expect(await verify(secret, String(now / 1000 + 1), body, header, { now: () => now })).toBe(false);
  });

  it("compares strings of unequal length without throwing", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });
});
