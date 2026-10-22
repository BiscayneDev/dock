// dock-node daemon tests. Run: npm test (in node/dock-node) or node --test node/dock-node/test/
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, stat, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ApiError } from "../src/api.mjs"
import { executeRun } from "../src/executor.mjs"
import { backoffMs, runLoop } from "../src/loop.mjs"
import { loadConfig, saveConfig, configPath } from "../src/config.mjs"
import { detectLocalTools } from "../src/local-tools.mjs"
import { isMoneyAction } from "../src/money.mjs"

// Fake API that records every call. `infer` and `complete` can be made to fail.
function fakeApi(overrides = {}) {
  const calls = []
  const api = {
    calls,
    heartbeat: async () => ({ ok: true }),
    claim: async () => null,
    event: async (runId, kind, data) => {
      calls.push({ op: "event", runId, kind, data })
      return { ok: true }
    },
    complete: async (runId, body) => {
      calls.push({ op: "complete", runId, body })
      return { id: runId }
    },
    infer: async (runId) => {
      calls.push({ op: "infer", runId })
      return { text: "done", costCents: 3 }
    },
    ...overrides,
  }
  return api
}

const moneyRun = {
  id: "11111111-1111-4111-8111-111111111111",
  agentKey: "vic",
  proposedAction: { id: "act-1", type: "x402_spend", amountCents: 250, destination: "seller.example" },
}

test("money: an unapproved money action is refused, sent to the gate, and the model is never called", async () => {
  const api = fakeApi()
  const result = await executeRun(moneyRun, { api })
  assert.equal(result.outcome, "awaiting_approval")
  assert.equal(api.calls.some((c) => c.op === "infer"), false, "no model call for a money action")
  const gate = api.calls.find((c) => c.op === "complete")
  assert.deepEqual(gate.body, { status: "awaiting_approval" })
  assert.ok(api.calls.some((c) => c.op === "event" && c.kind === "action_refused" && c.data.type === "x402_spend"))
})

test("money: an action the owner already approved is still refused on the home node and failed", async () => {
  const api = fakeApi({
    complete: async (runId, body) => {
      api.calls.push({ op: "complete", runId, body })
      if (body.status === "awaiting_approval") throw new ApiError(409, "money action already decided")
      return { id: runId }
    },
  })
  const result = await executeRun(moneyRun, { api })
  assert.equal(result.outcome, "refused")
  assert.equal(api.calls.some((c) => c.op === "infer"), false)
  const last = api.calls.filter((c) => c.op === "complete").at(-1)
  assert.equal(last.body.status, "failed")
})

test("money: every money type is detected; ordinary actions are not", () => {
  for (const type of ["x402_spend", "moonpay_refund", "payout_change"]) {
    assert.equal(isMoneyAction({ id: "a", type }), true, type)
  }
  assert.equal(isMoneyAction({ id: "a", type: "send_email" }), false)
  assert.equal(isMoneyAction(null), false)
})

test("execution: a normal run calls the model through Dock and completes with the output", async () => {
  const api = fakeApi()
  const result = await executeRun({ id: "r1", agentKey: "vic", proposedAction: null }, { api })
  assert.equal(result.outcome, "succeeded")
  assert.deepEqual(
    api.calls.map((c) => c.op),
    ["event", "infer", "complete"],
    "started, then one infer, then complete",
  )
  assert.deepEqual(api.calls.at(-1).body, { status: "succeeded", output: "done" })
})

test("execution: a failed model call completes the run as failed with the error", async () => {
  const api = fakeApi({
    infer: async () => {
      throw new ApiError(409, "budget")
    },
  })
  const result = await executeRun({ id: "r2", agentKey: "vic" }, { api })
  assert.equal(result.outcome, "failed")
  assert.equal(api.calls.at(-1).body.status, "failed")
  assert.equal(api.calls.at(-1).body.error, "budget")
})

test("execution: a 401 during a run is rethrown so the loop can stop on a revoked token", async () => {
  const api = fakeApi({
    infer: async () => {
      throw new ApiError(401, "Unauthorized")
    },
  })
  await assert.rejects(executeRun({ id: "r3", agentKey: "vic" }, { api }), (err) => err.status === 401)
})

test("local tools: absent cua-driver is reported as 'no local desktop tools'", async () => {
  const tools = detectLocalTools({ enabled: true, which: () => null })
  assert.deepEqual(tools, { available: false, tool: "cua-driver", message: "no local desktop tools" })
  const api = fakeApi()
  await executeRun({ id: "r4", agentKey: "vic" }, { api, localTools: tools })
  const ev = api.calls.find((c) => c.kind === "local_tools")
  assert.equal(ev.data.message, "no local desktop tools")
  assert.equal(detectLocalTools({ enabled: false, which: () => "/x" }), null, "off unless the flag is set")
})

test("backoff: doubles from 1s and caps at 60s", () => {
  assert.equal(backoffMs(1), 1000)
  assert.equal(backoffMs(2), 2000)
  assert.equal(backoffMs(4), 8000)
  assert.equal(backoffMs(50), 60000)
})

test("loop: claims and runs until the token is revoked (401), then stops", async () => {
  const queue = [{ id: "r5", agentKey: "vic", proposedAction: null }]
  const log = []
  const api = fakeApi({
    claim: async () => {
      if (queue.length) return queue.shift()
      throw new ApiError(401, "Unauthorized")
    },
  })
  const result = await runLoop({
    api,
    executeRun,
    signal: new AbortController().signal,
    log: (m) => log.push(m),
    waitFn: async () => {},
    heartbeatMs: 1e9,
  })
  assert.equal(result.stopped, "revoked")
  assert.equal(result.runs, 1)
  assert.ok(log.some((m) => m.includes("token rejected")))
})

test("loop: a network error backs off and retries instead of exiting", async () => {
  let n = 0
  const waits = []
  const ac = new AbortController()
  const api = fakeApi({
    claim: async () => {
      n += 1
      if (n === 1) throw new Error("fetch failed")
      ac.abort()
      return null
    },
  })
  const result = await runLoop({
    api,
    executeRun,
    signal: ac.signal,
    log: () => {},
    waitFn: async (ms) => {
      waits.push(ms)
    },
    heartbeatMs: 1e9,
  })
  assert.equal(result.stopped, "signal")
  assert.equal(waits[0], 1000, "first failure waits 1s")
})

test("config: saved with mode 600 under DOCK_NODE_HOME and round-trips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dock-node-test-"))
  const env = { DOCK_NODE_HOME: dir }
  await saveConfig({ server: "https://example.test", deviceId: "d", deviceToken: "dockdev.x.y", name: "n" }, env)
  const st = await stat(configPath(env))
  assert.equal(st.mode & 0o777, 0o600)
  const cfg = await loadConfig(env)
  assert.equal(cfg.deviceToken, "dockdev.x.y")
  const raw = await readFile(configPath(env), "utf8")
  assert.ok(raw.includes("dockdev.x.y"), "token is stored locally, never sent anywhere else")
})
