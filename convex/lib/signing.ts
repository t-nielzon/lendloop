// web crypto only so the same code runs in the default convex runtime and in tests

export const SIGNATURE_VERSION = "v1";
export const TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

// compares every position so timing does not reveal where the mismatch is
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function sign(secret: string, timestamp: string | number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return toHex(mac);
}

export async function signatureHeader(
  secret: string,
  timestamp: string | number,
  body: string,
): Promise<string> {
  return `${SIGNATURE_VERSION}=${await sign(secret, timestamp, body)}`;
}

export type VerifyOptions = { now?: () => number; toleranceSeconds?: number };

export async function verify(
  secret: string,
  timestamp: string | null | undefined,
  body: string,
  signature: string | null | undefined,
  options: VerifyOptions = {},
): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = (options.now ?? Date.now)();
  const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
  if (Math.abs(now / 1000 - Number(timestamp)) > tolerance) return false;
  const prefix = `${SIGNATURE_VERSION}=`;
  if (!signature.startsWith(prefix)) return false;
  const expected = await sign(secret, timestamp, body);
  return constantTimeEqual(expected, signature.slice(prefix.length));
}
