import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { isValidDate } from "./lib/dates";
import { verify } from "./lib/signing";

const MAX_BODY_BYTES = 64 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Parsed = Record<string, unknown>;

// content-length can be absent or wrong (chunked uploads), so the stream is counted and cut off at the cap
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

// signature and freshness are checked on the raw text before any parsing so unsigned input never reaches the json parser
async function authenticate(request: Request): Promise<{ ok: true; body: Parsed } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, response: json(413, { error: "payload too large" }) };
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return { ok: false, response: json(413, { error: "payload too large" }) };
  const secret = process.env.LENDLOOP_INBOUND_SECRET ?? "";
  const valid = await verify(
    secret,
    request.headers.get("x-lendloop-timestamp"),
    raw,
    request.headers.get("x-lendloop-signature"),
  );
  if (!valid) return { ok: false, response: json(401, { error: "unauthorized" }) };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return { ok: true, body: parsed as Parsed };
  } catch {
    return { ok: false, response: json(400, { error: "invalid request" }) };
  }
}

const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max = 200) => v === undefined || (typeof v === "string" && v.length <= max);
const bad = () => json(400, { error: "invalid request" });

function route(handle: (ctx: ActionCtx, body: Parsed) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    return await handle(ctx, auth.body);
  });
}

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: route(async (ctx, body) => {
    if (typeof body.asOf !== "string" || !isValidDate(body.asOf)) return bad();
    // one page of at most 200 loans; hasMore is true when more are still due and the caller may post again
    const { loans, hasMore } = await ctx.runQuery(internal.automation.overdueLoans, { asOf: body.asOf });
    return json(200, { asOf: body.asOf, loans, hasMore });
  }),
});

http.route({
  path: "/n8n/reminder-sent",
  method: "POST",
  handler: route(async (ctx, body) => {
    const { idempotencyKey, loanId, asOf } = body;
    if (!isStr(idempotencyKey) || !isStr(loanId) || typeof asOf !== "string" || !isValidDate(asOf)) return bad();
    const result = await ctx.runMutation(internal.automation.recordReminder, { idempotencyKey, loanId, asOf });
    if (result === "invalid") return bad();
    return json(200, { status: result });
  }),
});

http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: route(async (ctx, body) => {
    const { idempotencyKey, workflowName, nodeName, executionId, message } = body;
    if (!isStr(idempotencyKey) || !isStr(workflowName) || typeof message !== "string" || message.length === 0) return bad();
    if (!optStr(nodeName) || !optStr(executionId)) return bad();
    await ctx.runMutation(internal.automation.recordAutomationError, {
      idempotencyKey,
      workflowName,
      nodeName: nodeName as string | undefined,
      executionId: executionId as string | undefined,
      message,
    });
    return json(200, { status: "recorded" });
  }),
});

export default http;
