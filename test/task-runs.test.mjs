// Spend gate, budget and money-action rules for the cloud worker (P2).
// Run: node --test test/task-runs.test.mjs   (Node 23.6+ strips TypeScript types natively)
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  canSpend,
  centsFromUsd,
  decideMoneyGate,
  executeApprovedAction,
  proposedActionFromPayload,
  resumePlan,
  EVENT,
} from "../lib/task-runs.ts"

const action = { id: "act-1", type: "x402_spend", amountCents: 250, destination: "seller.example", description: "buy dataset" }

test("budget: refuses a call that would exceed the cap, allows one that fits", () => {
  assert.equal(canSpend(0, 10, 10), true, "exactly at the cap is allowed")
  assert.equal(canSpend(0, 10, 9), false, "estimate above budget is refused")
  assert.equal(canSpend(95, 10, 100), false, "spent + estimate over budget is refused")
  assert.equal(canSpend(-1, 10, 100), false, "negative spend is refused")
  assert.equal(canSpend(NaN, 10, 100), false, "non-finite input is refused")
})

test("metering: USD cost rounds up to whole cents; unknown cost is null", () => {
  assert.equal(centsFromUsd(0.0012), 1)
  assert.equal(centsFromUsd(0.01), 1)
  assert.equal(centsFromUsd(0.02), 2)
  assert.equal(centsFromUsd(null), null)
  assert.equal(centsFromUsd(undefined), null)
  assert.equal(centsFromUsd(-0.5), null)
})

test("spend gate: a money action with no decision goes to approval, never to execution", () => {
  const d = decideMoneyGate(action, [])
  assert.equal(d.kind, "request_approval")
  assert.equal(d.action.id, "act-1")
})

test("spend gate: only an approval event for that action id unlocks execution", () => {
  const otherApproved = [{ kind: EVENT.approvalGranted, data: { actionId: "act-2" } }]
  assert.equal(decideMoneyGate(action, otherApproved).kind, "request_approval")
  const approved = [{ kind: EVENT.approvalGranted, data: { actionId: "act-1" } }]
  assert.equal(decideMoneyGate(action, approved).kind, "execute")
})

test("spend gate: a rejected action is never executed; an executed one is never repeated", () => {
  const rejected = [{ kind: EVENT.approvalRejected, data: { actionId: "act-1" } }]
  assert.equal(decideMoneyGate(action, rejected).kind, "rejected")
  const done = [
    { kind: EVENT.approvalGranted, data: { actionId: "act-1" } },
    { kind: EVENT.actionExecuted, data: { actionId: "act-1" } },
  ]
  assert.equal(decideMoneyGate(action, done).kind, "already_done")
})

test("spend gate: non-money actions and no action pass straight through", () => {
  assert.equal(decideMoneyGate({ id: "x", type: "send_email" }, []).kind, "none")
  assert.equal(decideMoneyGate(null, []).kind, "none")
})

test("dry run: approved fake money action executes exactly once through the fake executor", async () => {
  let calls = 0
  const fake = { x402_spend: async (a) => { calls += 1; return { reference: `dry:${a.id}` } } }
  const events = [{ kind: EVENT.approvalGranted, data: { actionId: "act-1" } }]
  if (decideMoneyGate(action, events).kind === "execute") {
    const r = await executeApprovedAction(action, fake)
    assert.equal(r.reference, "dry:act-1")
  }
  assert.equal(calls, 1)
})

test("real executors are stubs: an approved x402 spend throws 'not implemented: x402 spend'", async () => {
  await assert.rejects(() => executeApprovedAction(action), { message: "not implemented: x402 spend" })
  await assert.rejects(() => executeApprovedAction({ id: "m", type: "moonpay_refund" }), /not implemented: moonpay refund/)
})

test("executeApprovedAction refuses non-money actions outright", async () => {
  await assert.rejects(() => executeApprovedAction({ id: "e", type: "send_email" }, {}), /refusing to execute/)
})

test("resumePlan: running run resumes from the last checkpoint's step and snapshot", () => {
  const plan = resumePlan(
    "running",
    [{ kind: "checkpoint", data: { step: 3, snapshot: { cursor: 12 } } }],
    [],
  )
  assert.deepEqual(plan, { ok: true, fromStep: 3, snapshot: { cursor: 12 } })
})

test("resumePlan: terminal runs (succeeded, failed, cancelled) are never resumed", () => {
  assert.deepEqual(resumePlan("succeeded", [{ kind: "checkpoint", data: { step: 3 } }], []), { ok: false, reason: "terminal" })
  assert.deepEqual(resumePlan("failed", [], []), { ok: false, reason: "terminal" })
  assert.deepEqual(resumePlan("cancelled", [], []), { ok: false, reason: "terminal" })
})

test("resumePlan: queued run with no checkpoint starts fresh at step 0", () => {
  assert.deepEqual(resumePlan("queued", [], []), { ok: true, fromStep: 0, snapshot: null })
})

test("resumePlan: uses the LAST checkpoint; missing/invalid step defaults to 0; null snapshot when absent", () => {
  const events = [
    { kind: "checkpoint", data: { step: 1, snapshot: { cursor: 2 } } },
    { kind: "checkpoint", data: { step: 5, snapshot: { cursor: 50 } } },
  ]
  assert.deepEqual(resumePlan("running", events, []), { ok: true, fromStep: 5, snapshot: { cursor: 50 } })
  assert.deepEqual(resumePlan("running", [{ kind: "checkpoint", data: { snapshot: { x: 1 } } }], []), { ok: true, fromStep: 0, snapshot: { x: 1 } })
  assert.deepEqual(resumePlan("running", [{ kind: "checkpoint", data: { step: "3" } }], []), { ok: true, fromStep: 0, snapshot: null })
  assert.deepEqual(resumePlan("running", [{ kind: "started", data: {} }], []), { ok: true, fromStep: 0, snapshot: null })
})

test("proposedActionFromPayload: parses a valid action, rejects malformed ones", () => {
  assert.deepEqual(proposedActionFromPayload({ proposedAction: { id: "a", type: "x402_spend", amountCents: 5 } }).amountCents, 5)
  assert.equal(proposedActionFromPayload({}), null)
  assert.equal(proposedActionFromPayload({ proposedAction: { type: "x402_spend" } }), null)
  assert.equal(proposedActionFromPayload({ proposedAction: "x402_spend" }), null)
})
