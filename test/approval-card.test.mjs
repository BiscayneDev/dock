// Approval card data mapping, owner refusal, reject/second-click rules, and the confirmation threshold (P2 assistant).
// Run: node --test test/approval-card.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  APPROVAL_CONFIRM_CENTS,
  buildApprovalCards,
  formatCents,
  needsSecondClick,
  safeScreenshotUrl,
} from "../lib/approval-card.ts"
import { canDecideRun, planDecision, statusAfterDecision, EVENT } from "../lib/task-runs.ts"

const CONV = "11111111-1111-4111-8111-111111111111"
const OTHER_CONV = "22222222-2222-4222-8222-222222222222"

// Seeded fixture: exists only in this test file, never written to the database.
function fullRun(overrides = {}) {
  return {
    id: "run-full",
    status: "awaiting_approval",
    conversationId: CONV,
    projectId: "proj-1",
    model: "shipyard/fast-model",
    budgetCents: 1000,
    payload: { modelReason: "Chosen in the composer for this message" },
    ...overrides,
  }
}
function requested(runId, data = {}) {
  return {
    runId,
    kind: "approval_requested",
    createdAt: "2026-10-22T12:00:00.000Z",
    data: {
      actionId: "act-1",
      type: "x402_spend",
      amountCents: 250,
      destination: "https://seller.example/api",
      description: "Buy the market dataset for the pricing study",
      proposal: "Buy the market dataset for the pricing study",
      target: "https://seller.example/api",
      estimatedCents: 250,
      budgetCents: 1000,
      model: "shipyard/fast-model",
      modelReason: "Chosen in the composer for this message",
      projectId: "proj-1",
      conversationId: CONV,
      screenshotUrl: null,
      ...data,
    },
  }
}
const PROJECTS = { "proj-1": "Pricing study" }

test("pending approval with all fields maps to a pending card", () => {
  const cards = buildApprovalCards([fullRun()], [requested("run-full")], CONV, PROJECTS, () => true)
  assert.equal(cards.length, 1)
  const c = cards[0]
  assert.equal(c.status, "pending")
  assert.equal(c.statusLabel, "Waiting for your decision")
  assert.equal(c.proposal, "Buy the market dataset for the pricing study")
  assert.equal(c.target, "https://seller.example/api")
  assert.equal(c.model, "shipyard/fast-model")
  assert.equal(c.modelReason, "Chosen in the composer for this message")
  assert.equal(c.estimatedLabel, "$2.50")
  assert.equal(c.budgetLabel, "$10.00")
  assert.equal(c.projectName, "Pricing study")
  assert.equal(c.screenshotUrl, null, "no screenshot supplied: the card shows 'No preview yet'")
  assert.equal(c.requiresConfirm, false)
  assert.equal(c.canDecide, true)
  assert.match(c.footer, /Money moves only through the payment step/)
})

test("pending approval with nulls renders 'unknown', never a guess", () => {
  const run = fullRun({ model: null, projectId: null, budgetCents: 0, payload: {} })
  const bare = requested("run-full", {
    proposal: null,
    description: null,
    target: null,
    destination: null,
    estimatedCents: null,
    amountCents: null,
    budgetCents: null,
    model: null,
    modelReason: null,
    projectId: null,
    screenshotUrl: "javascript:alert(1)",
  })
  const [c] = buildApprovalCards([run], [bare], CONV, PROJECTS, () => true)
  assert.equal(c.proposal, "unknown")
  assert.equal(c.target, "unknown")
  assert.equal(c.model, "unknown")
  assert.equal(c.modelReason, "unknown")
  assert.equal(c.projectName, "unknown")
  assert.equal(c.estimatedLabel, "unknown")
  assert.equal(c.budgetLabel, "$0.00", "a run budget of 0 is a real value, not unknown")
  assert.equal(c.screenshotUrl, null, "non-https screenshot is not shown")
  assert.equal(c.requiresConfirm, false, "unknown cost never triggers or skips the threshold by guess")
})

test("only approvals for the requested conversation are returned", () => {
  const other = fullRun({ id: "run-other", conversationId: OTHER_CONV })
  const cards = buildApprovalCards([fullRun(), other], [requested("run-full"), requested("run-other")], CONV, PROJECTS)
  assert.deepEqual(cards.map((c) => c.runId), ["run-full"])
})

test("rejected run shows rejected status and no decision buttons", () => {
  const run = fullRun({ status: "cancelled" })
  const events = [
    requested("run-full"),
    { runId: "run-full", kind: EVENT.approvalRejected, createdAt: "2026-10-22T12:05:00.000Z", data: { actionId: "act-1" } },
  ]
  const [c] = buildApprovalCards([run], events, CONV, PROJECTS, () => true)
  assert.equal(c.status, "rejected")
  assert.equal(c.decidedAt, "2026-10-22T12:05:00.000Z")
  assert.equal(c.canDecide, false)
})

test("approval for a run that ended without a decision is closed, not pending", () => {
  const run = fullRun({ status: "failed" })
  const [c] = buildApprovalCards([run], [requested("run-full")], CONV, PROJECTS, () => true)
  assert.equal(c.status, "closed")
  assert.equal(c.canDecide, false)
})

test("approve is refused for a non-owner; the service role (connector) is trusted", () => {
  assert.equal(canDecideRun("owner-a", "owner-b"), false)
  assert.equal(canDecideRun("owner-a", "owner-a"), true)
  assert.equal(canDecideRun("owner-a", null), true, "service-role decisions (Dinghy connector) pass no user")
  const cards = buildApprovalCards([fullRun()], [requested("run-full")], CONV, PROJECTS, () => false)
  assert.equal(cards[0].canDecide, false, "a non-owner never gets an enabled Approve")
})

test("reject moves the run to cancelled; approve re-queues it", () => {
  assert.equal(statusAfterDecision("reject"), "cancelled")
  assert.equal(statusAfterDecision("approve"), "queued")
  const plan = planDecision("awaiting_approval", [{ kind: EVENT.approvalRequested, data: requested("run-full").data }])
  assert.equal(plan.ok, true)
  assert.equal(plan.actionId, "act-1")
  assert.equal(plan.amountCents, 250)
})

test("a second click on an already decided approval is a no-op", () => {
  const req = { kind: EVENT.approvalRequested, data: requested("run-full").data }
  const granted = { kind: EVENT.approvalGranted, data: { actionId: "act-1" } }
  const rejected = { kind: EVENT.approvalRejected, data: { actionId: "act-1" } }
  assert.deepEqual(planDecision("queued", [req, granted]), { ok: false, reason: "not_awaiting_approval" })
  assert.deepEqual(planDecision("awaiting_approval", [req, granted]), { ok: false, reason: "already_decided" })
  assert.deepEqual(planDecision("awaiting_approval", [req, rejected]), { ok: false, reason: "already_decided" })
  assert.deepEqual(planDecision("awaiting_approval", []), { ok: false, reason: "no_pending_action" })
})

test("estimates above the threshold need a second click that shows the amount", () => {
  assert.equal(APPROVAL_CONFIRM_CENTS, 500)
  const big = requested("run-big", { estimatedCents: 501, amountCents: 501, actionId: "act-big" })
  const [c] = buildApprovalCards([fullRun({ id: "run-big" })], [big], CONV, PROJECTS, () => true)
  assert.equal(c.requiresConfirm, true)
  assert.equal(c.estimatedLabel, "$5.01")
  assert.equal(needsSecondClick(c, false), true, "first click only asks for confirmation")
  assert.equal(needsSecondClick(c, true), false, "second click sends the approval")

  const atLimit = requested("run-edge", { estimatedCents: 500, amountCents: 500 })
  const [e] = buildApprovalCards([fullRun({ id: "run-edge" })], [atLimit], CONV, PROJECTS, () => true)
  assert.equal(e.requiresConfirm, false, "exactly at the limit does not need a second click")
  assert.equal(needsSecondClick(e, false), false)
})

test("formatCents and screenshot URL rules", () => {
  assert.equal(formatCents(null), "unknown")
  assert.equal(formatCents(-5), "unknown")
  assert.equal(formatCents(7), "$0.07")
  assert.equal(safeScreenshotUrl("https://cdn.example/shot.png"), "https://cdn.example/shot.png")
  assert.equal(safeScreenshotUrl("http://cdn.example/shot.png"), null)
  assert.equal(safeScreenshotUrl("not a url"), null)
  assert.equal(safeScreenshotUrl(undefined), null)
})
