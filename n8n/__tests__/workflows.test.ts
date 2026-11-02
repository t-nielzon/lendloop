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
  it("turns off the n8n attribution footer on every email node", () => {
    for (const w of [wf1, wf2, wf3]) {
      for (const n of w.nodes.filter((n) => n.type.includes("emailSend"))) {
        expect((n.parameters.options as { appendAttribution?: boolean } | undefined)?.appendAttribution).toBe(false);
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

const wf4 = load("pickup-reminders.json");
const wf5 = load("stale-request-followup.json");
const wf6 = load("delivery-health-monitor.json");
const added = [wf4, wf5, wf6];

// every node reachable from a start node, optionally stopping at a node name
function reachable(w: Workflow, start: string, stopAt?: string) {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur) || cur === stopAt) continue;
    seen.add(cur);
    for (const outs of w.connections[cur]?.main ?? []) for (const c of outs) queue.push(c.node);
  }
  return seen;
}
const typesOf = (w: Workflow, names: Set<string>) => [...names].map((n) => node(w, n).type);

describe("dual-secret verify", () => {
  const withPrevious = (opts: { secret?: string; previous?: string | undefined }) => {
    const ts = now();
    const item = {
      json: { headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": backendSign(opts.secret ?? SECRET, ts, body) } },
      binary: { data: {} },
    };
    return runCode(
      wf1,
      "Verify signature",
      { $input: { first: () => item }, $env: { LENDLOOP_OUTBOUND_SECRET: SECRET, LENDLOOP_OUTBOUND_SECRET_PREVIOUS: opts.previous } },
      { getBinaryDataBuffer: async () => Buffer.from(body) },
    ).then((r: { json: Record<string, unknown> }[]) => r[0].json);
  };
  it("accepts the current secret", async () => {
    expect((await withPrevious({ previous: "old-secret" })).valid).toBe(true);
  });
  it("accepts the previous secret", async () => {
    expect((await withPrevious({ secret: "old-secret", previous: "old-secret" })).valid).toBe(true);
  });
  it("rejects an unknown secret even when a previous one is set", async () => {
    expect(await withPrevious({ secret: "stranger", previous: "old-secret" })).toMatchObject({ valid: false, reason: "bad signature" });
  });
  it("ignores an empty or unset previous secret", async () => {
    expect(await withPrevious({ secret: "", previous: "" })).toMatchObject({ valid: false });
    expect(await withPrevious({ secret: "", previous: undefined })).toMatchObject({ valid: false });
  });
});

describe("added workflows structure", () => {
  it("uses fixed unique ids and the shared error handler", () => {
    expect(added.map((w) => w.id)).toEqual(["lendloopPickup00001", "lendloopStale000001", "lendloopHealth00001"]);
    for (const w of added) expect(w.settings.errorWorkflow).toBe(wf3.id);
  });
  it("has a schedule trigger, a manual trigger and a sticky note", () => {
    for (const w of added) {
      for (const t of ["scheduleTrigger", "manualTrigger", "stickyNote"]) expect(w.nodes.some((n) => n.type.endsWith(t))).toBe(true);
    }
  });
  it("retries http three times and email twice, with attribution off", () => {
    for (const w of added) {
      for (const n of w.nodes.filter((n) => /httpRequest|emailSend/.test(n.type))) {
        const email = n.type.includes("emailSend");
        expect([n.retryOnFail, n.maxTries, n.waitBetweenTries]).toEqual([true, email ? 2 : 3, email ? 3000 : 5000]);
        if (email) expect((n.parameters.options as { appendAttribution?: boolean }).appendAttribution).toBe(false);
      }
    }
  });
  it("is published by the import script", () => {
    const script = readFileSync(join(__dirname, "../import.sh"), "utf8");
    for (const w of [wf1, wf2, wf3, ...added]) expect(script).toContain(w.id);
  });
  it("contains no secrets", () => {
    for (const f of ["pickup-reminders.json", "stale-request-followup.json", "delivery-health-monitor.json"]) {
      expect(readFileSync(join(__dirname, "../workflows", f), "utf8")).not.toMatch(/secret-|password":\s*"[^"]/i);
    }
  });
});

describe("added signing nodes", () => {
  const env = { LENDLOOP_INBOUND_SECRET: "inbound-secret", LENDLOOP_CONVEX_SITE_URL: "http://convex-backend:3211", GENERIC_TIMEZONE: "UTC" };
  const loanCtx = (loan: Record<string, unknown>) => ({ $env: env, $: () => ({ first: () => ({ json: loan }) }) });
  const check = (json: { url: string; body: string; headers: Record<string, string> }, path: string, key: string) => {
    expect(json.url).toBe(`http://convex-backend:3211${path}`);
    expect(JSON.parse(json.body).idempotencyKey).toBe(key);
    expect(json.headers["X-LendLoop-Event-Id"]).toBe(key);
    expect(json.headers["X-LendLoop-Signature"]).toBe(backendSign("inbound-secret", json.headers["X-LendLoop-Timestamp"], json.body));
  };
  it("signs the pickup, stale and health queries with the current secret only", async () => {
    const [pickup] = await runCode(wf4, "Sign upcoming-pickups request", { $env: env });
    expect(JSON.parse(pickup.json.body)).toEqual({ asOf: pickup.json.asOf });
    expect(pickup.json.url).toContain("/n8n/upcoming-pickups");
    const [stale] = await runCode(wf5, "Sign stale-requests request", { $env: env });
    expect(stale.json.url).toContain("/n8n/stale-requests");
    const [health] = await runCode(wf6, "Sign delivery-health request", { $env: env });
    expect(JSON.parse(health.json.body)).toEqual({});
    expect(health.json.headers["X-LendLoop-Signature"]).toBe(backendSign("inbound-secret", health.json.headers["X-LendLoop-Timestamp"], "{}"));
    await expect(runCode(wf6, "Sign delivery-health request", { $env: {} })).rejects.toThrow(/not set/);
  });
  it("builds the contract idempotency keys", async () => {
    const pickup = await runCode(wf4, "Sign pickup-reminder-sent request", loanCtx({ loanId: "l1", asOf: "2026-11-03" }));
    check(pickup.json, "/n8n/pickup-reminder-sent", "pickup-reminder:l1:2026-11-03");
    const nudge = await runCode(wf5, "Sign request-nudged request", loanCtx({ loanId: "l2" }));
    check(nudge.json, "/n8n/request-nudged", "request-nudge:l2");
    const expire = await runCode(wf5, "Sign expire-request request", loanCtx({ loanId: "l3" }));
    check(expire.json, "/n8n/expire-request", "request-expire:l3");
    const inc = { incidentKey: "abc123", dead: 2, stuckPending: 1, oldestStuckAt: 1700000000000 };
    const health = await runCode(wf6, "Sign health-alert-sent request", loanCtx(inc));
    check(health.json, "/n8n/health-alert-sent", "health-alert:abc123");
    expect(JSON.parse(health.json.body)).toMatchObject({ incidentKey: "abc123", dead: 2, stuckPending: 1, oldestStuckAt: 1700000000000 });
  });
});

describe("pickup reminders loop", () => {
  it("emails borrower then owner and writes back only after both succeed", () => {
    expect(next(wf4, "Loop Over Items", 1)).toEqual(["Email borrower"]);
    expect(next(wf4, "Email borrower", 0)).toEqual(["Email owner"]);
    expect(next(wf4, "Email owner", 0)).toEqual(["Sign pickup-reminder-sent request"]);
    expect(next(wf4, "Sign pickup-reminder-sent request")).toEqual(["Record pickup reminder in Convex"]);
    expect(next(wf4, "Record pickup reminder in Convex", 0)).toEqual(["Mark sent"]);
    expect(next(wf4, "Mark sent")).toEqual(["Loop Over Items"]);
    // either email failing skips the write-back
    expect(next(wf4, "Email borrower", 1)).toEqual(["Mark failed"]);
    expect(next(wf4, "Email owner", 1)).toEqual(["Mark failed"]);
    expect(reachable(wf4, "Mark failed", "Loop Over Items").has("Record pickup reminder in Convex")).toBe(false);
  });
  it("pages while hasMore within a bound and fails the run at the end", async () => {
    expect(node(wf4, "Loop Over Items").parameters.batchSize).toBe(1);
    expect(next(wf4, "More pages?", 0)).toEqual(["Sign upcoming-pickups request"]);
    expect(next(wf4, "More pages?", 1)).toEqual(["Fail if any failed"]);
    expect(node(wf4, "Summarize page").parameters.jsCode).toMatch(/MAX_PAGES = 10/);
    await expect(runCode(wf4, "Fail if any failed", { $input: { first: () => ({ json: { failedTotal: 1, hasMore: false, failures: [{ loanId: "l1", error: "smtp" }] } }) } })).rejects.toThrow(/1 failed/);
  });
  it("stops paging at the page bound", async () => {
    const run = (runIndex: number) =>
      runCode(wf4, "Summarize page", {
        $input: { all: () => [{ json: { ok: true, loanId: "l" } }] },
        $getWorkflowStaticData: () => ({}),
        $runIndex: runIndex,
        $: () => ({ last: () => ({ json: { hasMore: true } }) }),
      }).then((r: { json: { canContinue: boolean } }[]) => r[0].json.canContinue);
    expect(await run(0)).toBe(true);
    expect(await run(9)).toBe(false);
  });
});

describe("stale request follow-up loop", () => {
  it("splits nudges and expiries into one loop", async () => {
    const res = { asOf: "2026-11-03", toNudge: [{ loanId: "a" }], toExpire: [{ loanId: "b" }] };
    const out = await runCode(wf5, "Split stale requests", { $input: { first: () => ({ json: res }) }, $: () => ({ last: () => ({ json: res }) }) });
    expect(out.map((i: { json: { kind: string } }) => i.json.kind)).toEqual(["nudge", "expire"]);
  });
  it("writes back the nudge right after the owner email", () => {
    expect(next(wf5, "Needs nudge?", 0)).toEqual(["Email owner about waiting request"]);
    expect(next(wf5, "Email owner about waiting request", 0)).toEqual(["Sign request-nudged request"]);
    expect(next(wf5, "Record nudge in Convex", 0)).toEqual(["Mark sent"]);
    expect(next(wf5, "Mark sent")).toEqual(["Loop Over Items"]);
  });
  it("expires through Convex without any email on that path", () => {
    expect(next(wf5, "Needs nudge?", 1)).toEqual(["Sign expire-request request"]);
    const path = reachable(wf5, "Sign expire-request request", "Loop Over Items");
    expect(typesOf(wf5, path).some((t) => t.includes("emailSend"))).toBe(false);
    expect(path.has("Expire request in Convex")).toBe(true);
  });
  it("treats a skipped expiry as success because only errors reach the failure branch", () => {
    expect(node(wf5, "Expire request in Convex").onError).toBe("continueErrorOutput");
    expect(next(wf5, "Expire request in Convex", 0)).toEqual(["Mark sent"]);
    expect(next(wf5, "Expire request in Convex", 1)).toEqual(["Mark failed"]);
  });
  it("pages while hasMore and fails at the end", () => {
    expect(next(wf5, "More pages?", 0)).toEqual(["Sign stale-requests request"]);
    expect(next(wf5, "More pages?", 1)).toEqual(["Fail if any failed"]);
  });
});

describe("delivery health monitor", () => {
  const evaluate = (res: Record<string, unknown>, store: Record<string, unknown>) =>
    runCode(wf6, "Evaluate incident", { $input: { first: () => ({ json: res }) }, $getWorkflowStaticData: () => store }).then((r: { json: Record<string, unknown> }[]) => r[0].json);
  it("stops when healthy or already alerted, alerts on a new key", async () => {
    const store: Record<string, unknown> = {};
    expect(await evaluate({ incidentKey: null, dead: 0, stuckPending: 0 }, store)).toMatchObject({ shouldAlert: false });
    expect(await evaluate({ incidentKey: "k1", dead: 1, stuckPending: 0 }, store)).toMatchObject({ shouldAlert: true, incidentKey: "k1" });
    store.alertedIncidentKeys = ["k1"];
    expect(await evaluate({ incidentKey: "k1", dead: 1, stuckPending: 0 }, store)).toMatchObject({ shouldAlert: false });
  });
  it("remembers at most the last 100 keys, after the write-back", async () => {
    const store: Record<string, unknown> = { alertedIncidentKeys: Array.from({ length: 100 }, (_, i) => `k${i}`) };
    await runCode(wf6, "Remember incident", { $: () => ({ first: () => ({ json: { incidentKey: "new" } }) }), $getWorkflowStaticData: () => store });
    const keys = store.alertedIncidentKeys as string[];
    expect(keys).toHaveLength(100);
    expect(keys[99]).toBe("new");
    expect(keys).not.toContain("k0");
    expect(next(wf6, "Email delivery alert", 0)).toEqual(["Sign health-alert-sent request"]);
    expect(next(wf6, "Record health alert in Convex", 0)).toEqual(["Remember incident"]);
  });
  it("raises an error when the email or write-back fails", async () => {
    expect(next(wf6, "Email delivery alert", 1)).toEqual(["Report failure"]);
    expect(next(wf6, "Record health alert in Convex", 1)).toEqual(["Report failure"]);
    await expect(runCode(wf6, "Report failure", { $json: { error: { message: "smtp down" } } })).rejects.toThrow(/smtp down/);
  });
});

describe("compose email", () => {
  it("words an expired request for the borrower", async () => {
    const payload = { ...JSON.parse(body), loan: { id: "l1", status: "expired", previousStatus: "requested", startDate: "2026-11-01", endDate: "2026-11-02" } };
    const [{ json }] = await runCode(wf1, "Compose email", { $input: { first: () => ({ json: { payload } }) } });
    expect(json.subject).toBe("Your request for Drill expired");
    expect(json.text).toContain("start date passed without a decision");
    expect(json.to).toBe("sam@example.com");
  });
});
