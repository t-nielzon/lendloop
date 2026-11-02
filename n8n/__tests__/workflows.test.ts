import * as nodeCrypto from "node:crypto";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type WfNode = { name: string; type: string; parameters: Record<string, unknown>; retryOnFail?: boolean; maxTries?: number; waitBetweenTries?: number; onError?: string };
type Conns = Record<string, { main: { node: string }[][] }>;
type Workflow = { id: string; name: string; nodes: WfNode[]; connections: Conns; settings: Record<string, unknown> };

const load = (file: string): Workflow =>
  JSON.parse(readFileSync(join(__dirname, "../workflows", file), "utf8"));
const wf1 = load("loan-status-notification.json");
const wf2 = load("overdue-reminders.json");
const wf3 = load("error-handler.json");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// runs a code node body the way n8n does: injected globals, `this.helpers`, top-level await and return
async function runCode(wf: Workflow, nodeName: string, globals: Record<string, unknown>, helpers: unknown = {}) {
  const node = wf.nodes.find((n) => n.name === nodeName)!;
  const names = Object.keys(globals);
  const fn = new AsyncFunction("require", ...names, node.parameters.jsCode as string);
  return fn.call({ helpers }, (id: string) => (id === "crypto" ? nodeCrypto : (() => { throw new Error("blocked"); })()), ...names.map((n) => globals[n]));
}

// same algorithm as the backend signing helper: hmac-sha256 hex over "<timestamp>.<body>"
const backendSign = (secret: string, ts: string, body: string) =>
  "v1=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

const SECRET = "outbound-secret";
const now = () => String(Math.floor(Date.now() / 1000));
const body = JSON.stringify({
  eventId: "evt-1",
  type: "loan.status_changed",
  loan: { id: "l1", status: "approved", startDate: "2026-11-10", endDate: "2026-11-12" },
  tool: { name: "Drill" },
  recipient: { firstName: "Sam", email: "sam@example.com" },
  link: "http://localhost:3000/loans/l1",
});

function verify(opts: { raw?: string; ts?: string; signature?: string; secret?: string; envSecret?: string }) {
  const raw = opts.raw ?? body;
  const ts = opts.ts ?? now();
  const signature = opts.signature ?? backendSign(opts.secret ?? SECRET, ts, body);
  const item = {
    json: { headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": signature } },
    binary: { data: { mimeType: "application/json" } },
  };
  return runCode(
    wf1,
    "Verify signature",
    { $input: { first: () => item }, $env: { LENDLOOP_OUTBOUND_SECRET: opts.envSecret ?? SECRET } },
    { getBinaryDataBuffer: async () => Buffer.from(raw) },
  ).then((r: { json: Record<string, unknown> }[]) => r[0].json);
}

describe("verify signature node", () => {
  it("accepts a valid signature", async () => {
    const out = await verify({});
    expect(out.valid).toBe(true);
    expect(out.eventId).toBe("evt-1");
  });
  it("rejects a tampered body", async () => {
    const out = await verify({ raw: body.replace("approved", "declined") });
    expect(out).toMatchObject({ valid: false, reason: "bad signature" });
  });
  it("rejects a stale timestamp even when correctly signed", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 301);
    expect(await verify({ ts })).toMatchObject({ valid: false, reason: "stale timestamp" });
  });
  it("rejects a future timestamp beyond the window", async () => {
    const ts = String(Math.floor(Date.now() / 1000) + 400);
    expect(await verify({ ts })).toMatchObject({ valid: false });
  });
  it("rejects a wrong secret", async () => {
    expect(await verify({ secret: "other" })).toMatchObject({ valid: false, reason: "bad signature" });
  });
  it("rejects a signature of a different length without throwing", async () => {
    expect(await verify({ signature: "v1=abcd" })).toMatchObject({ valid: false });
  });
  it("rejects when the secret is not configured", async () => {
    expect(await verify({ envSecret: "" })).toMatchObject({ valid: false });
  });
});

describe("signing nodes", () => {
  const env = {
    LENDLOOP_INBOUND_SECRET: "inbound-secret",
    LENDLOOP_CONVEX_SITE_URL: "http://convex-backend:3211/",
    GENERIC_TIMEZONE: "UTC",
  };

  function expectVerifies(req: { url: string; body: string; headers: Record<string, string> }, path: string) {
    expect(req.url).toBe(`http://convex-backend:3211${path}`);
    const ts = req.headers["X-LendLoop-Timestamp"];
    expect(req.headers["X-LendLoop-Signature"]).toBe(backendSign("inbound-secret", ts, req.body));
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5);
  }

  it("signs the overdue request", async () => {
    const [{ json }] = await runCode(wf2, "Sign overdue request", { $env: env });
    expect(json.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.parse(json.body)).toEqual({ asOf: json.asOf });
    expectVerifies(json, "/n8n/overdue-loans");
  });

  it("signs the reminder-sent request with the contract idempotency key", async () => {
    const loan = { loanId: "l9", asOf: "2026-11-03" };
    const { json } = await runCode(wf2, "Sign reminder-sent request", {
      $env: env,
      $: () => ({ first: () => ({ json: loan }) }),
    });
    expect(JSON.parse(json.body)).toEqual({ idempotencyKey: "overdue-reminder:l9:2026-11-03", loanId: "l9", asOf: "2026-11-03" });
    expect(json.headers["X-LendLoop-Event-Id"]).toBe("overdue-reminder:l9:2026-11-03");
    expectVerifies(json, "/n8n/reminder-sent");
  });

  it("signs the workflow error report", async () => {
    const input = { execution: { id: "77", lastNodeExecuted: "Send reminder email", error: { message: "boom" } }, workflow: { name: "wf" } };
    const [{ json }] = await runCode(wf3, "Build alert", { $env: env, $input: { first: () => ({ json: input }) } });
    expect(JSON.parse(json.body)).toMatchObject({ idempotencyKey: "workflow-error:77", workflowName: "wf", executionId: "77", message: "boom" });
    expectVerifies(json, "/n8n/workflow-error");
  });
});

describe("workflow structure", () => {
  it("uses fixed ids and points both workflows at the error handler", () => {
    expect(wf1.settings.errorWorkflow).toBe(wf3.id);
    expect(wf2.settings.errorWorkflow).toBe(wf3.id);
  });
  it("retries http nodes three times and email nodes twice with a short wait", () => {
    for (const w of [wf1, wf2, wf3]) {
      for (const n of w.nodes.filter((n) => /httpRequest|emailSend/.test(n.type))) {
        const email = n.type.includes("emailSend");
        const loose = w === wf3 && email;
        expect(n.retryOnFail).toBe(true);
        expect(n.maxTries).toBe(email && !loose ? 2 : 3);
        expect(n.waitBetweenTries).toBe(email && !loose ? 3000 : 5000);
      }
    }
  });
  it("reads the raw body on the webhook path", () => {
    const hook = wf1.nodes.find((n) => n.type.endsWith("webhook"))!;
    expect(hook.parameters).toMatchObject({ path: "lendloop/loan-status", options: { rawBody: true } });
  });
  it("contains no secrets", () => {
    for (const f of ["loan-status-notification.json", "overdue-reminders.json", "error-handler.json"]) {
      expect(readFileSync(join(__dirname, "../workflows", f), "utf8")).not.toMatch(/secret-|password":\s*"[^"]/i);
    }
  });
});

const next = (w: Workflow, from: string, output = 0) => (w.connections[from]?.main[output] ?? []).map((c) => c.node);
const node = (w: Workflow, name: string) => w.nodes.find((n) => n.name === name)!;

describe("verify recipient", () => {
  it("rejects an empty or blank recipient email", async () => {
    for (const email of ["", "   "]) {
      const raw = JSON.stringify({ ...JSON.parse(body), recipient: { firstName: "Sam", email } });
      const ts = now();
      const item = {
        json: { headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": backendSign(SECRET, ts, raw) } },
        binary: { data: {} },
      };
      const [{ json }] = await runCode(wf1, "Verify signature", { $input: { first: () => item }, $env: { LENDLOOP_OUTBOUND_SECRET: SECRET } }, { getBinaryDataBuffer: async () => Buffer.from(raw) });
      expect(json).toMatchObject({ valid: false, reason: "invalid payload", statusCode: 400 });
    }
  });
});

describe("reminder loop structure", () => {
  it("sends one email per item and writes back right after each send", () => {
    const loop = node(wf2, "Loop Over Items");
    expect(loop.type).toBe("n8n-nodes-base.splitInBatches");
    expect(loop.parameters.batchSize).toBe(1);
    expect(next(wf2, "Split loans")).toEqual(["Loop Over Items"]);
    expect(next(wf2, "Loop Over Items", 1)).toEqual(["Send reminder email"]);
    expect(next(wf2, "Send reminder email", 0)).toEqual(["Sign reminder-sent request"]);
    expect(next(wf2, "Sign reminder-sent request")).toEqual(["Record reminder in Convex"]);
    expect(next(wf2, "Record reminder in Convex", 0)).toEqual(["Mark sent"]);
    expect(next(wf2, "Mark sent")).toEqual(["Loop Over Items"]);
  });
  it("routes failures back into the loop instead of stopping it", () => {
    expect(node(wf2, "Send reminder email").onError).toBe("continueErrorOutput");
    expect(node(wf2, "Record reminder in Convex").onError).toBe("continueErrorOutput");
    expect(next(wf2, "Send reminder email", 1)).toEqual(["Mark failed"]);
    expect(next(wf2, "Mark failed")).toEqual(["Loop Over Items"]);
  });
  it("pages again while more loans remain and fails the run when any send failed", () => {
    expect(next(wf2, "Loop Over Items", 0)).toEqual(["Summarize page"]);
    expect(next(wf2, "More pages?", 0)).toEqual(["Sign overdue request"]);
    expect(next(wf2, "More pages?", 1)).toEqual(["Fail if any failed"]);
  });
  it("summarizes failures into a thrown error", async () => {
    const summary = { failedTotal: 1, hasMore: false, failures: [{ loanId: "l1", error: "smtp down" }] };
    await expect(runCode(wf2, "Fail if any failed", { $input: { first: () => ({ json: summary }) } })).rejects.toThrow(/1 failed.*l1: smtp down/);
    const ok = await runCode(wf2, "Fail if any failed", { $input: { first: () => ({ json: { failedTotal: 0, hasMore: false, failures: [] } }) } });
    expect(ok).toHaveLength(1);
  });
});

describe("error handler order", () => {
  it("records in Convex before emailing and survives failures of either", () => {
    expect(next(wf3, "Build alert")).toEqual(["Record error in Convex"]);
    expect(next(wf3, "Record error in Convex")).toEqual(["Email alert"]);
    expect(node(wf3, "Record error in Convex").onError).toBe("continueRegularOutput");
    expect(node(wf3, "Email alert").onError).toBe("continueRegularOutput");
  });
  it("points the error workflow id at an existing workflow", () => {
    expect(wf3.id).toBe("lendloopErrHandler1");
    expect(wf1.settings.errorWorkflow).toBe("lendloopErrHandler1");
    expect(wf2.settings.errorWorkflow).toBe("lendloopErrHandler1");
  });
});
