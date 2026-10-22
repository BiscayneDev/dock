// Approval card: the model Jev picked, its tier and cost, and 'Model not previewed (reason)' when there is no route.
// Run: node --test test/approval-route-card.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildApprovalCards, formatUsd, parseApprovalRoute, routeSection } from "../lib/approval-card.ts"

const CONV = "11111111-1111-4111-8111-111111111111"
const ROUTE = {
  model: "fast-model",
  provider: "prov-a",
  tier: "low",
  estimatedCostUsd: 0.00042,
  estimateBasis: "120 input tokens estimated from the request text",
  routeId: "rte_abc123",
  jevConfidence: 0.82,
  previewedAt: "2026-10-22T12:00:00.000Z",
}

function run() {
  return {
    id: "run-1",
    status: "awaiting_approval",
    conversationId: CONV,
    projectId: null,
    model: "shipyard/auto",
    budgetCents: 1000,
    payload: {},
  }
}
function requested(data = {}) {
  return {
    runId: "run-1",
    kind: "approval_requested",
    createdAt: "2026-10-22T12:00:00.000Z",
    data: {
      actionId: "act-1",
      type: "x402_spend",
      amountCents: 250,
      destination: "https://seller.example/api",
      description: "Buy the dataset",
      proposal: "Buy the dataset",
      target: "https://seller.example/api",
      estimatedCents: 250,
      budgetCents: 1000,
      model: "shipyard/auto",
      screenshotUrl: null,
      ...data,
    },
  }
}
function card(data) {
  const [c] = buildApprovalCards([run()], [requested(data)], CONV, {}, () => true, Date.parse("2026-10-22T12:01:00Z"))
  return c
}
const rowOf = (c, label) => c.routeRows.find((r) => r.label === label)

test("route present: card shows model and provider Jev picked, tier and cost", () => {
  const c = card({ route: ROUTE, routeReason: null })
  assert.ok(c.route)
  assert.equal(rowOf(c, "Model Jev picked").value, "fast-model via prov-a")
  assert.equal(rowOf(c, "Model Jev picked").mono, true)
  assert.equal(rowOf(c, "Tier").value, "low")
  assert.equal(rowOf(c, "Model cost (estimate)").value, "$0.0004")
  assert.equal(c.routeRows.length, 3)
  assert.ok(c.routeBasis.includes("listed price"))
  assert.equal(c.route.estimateBasis, ROUTE.estimateBasis)
})

test("route null: card says 'Model not previewed' with the reason and no tier or cost rows", () => {
  const c = card({ route: null, routeReason: "timeout" })
  assert.equal(c.route, null)
  assert.deepEqual(c.routeRows, [{ label: "Model Jev picked", value: "Model not previewed (preview timed out)", mono: false }])
  assert.equal(c.routeBasis, null)
})

test("route null with an unknown or missing reason shows 'unknown', not a guess", () => {
  assert.equal(card({ route: null, routeReason: "weird_code" }).routeRows[0].value, "Model not previewed (unknown)")
  assert.equal(card({}).routeRows[0].value, "Model not previewed (unknown)")
})

test("not_configured reason is shown in words", () => {
  const c = card({ route: null, routeReason: "not_configured" })
  assert.equal(rowOf(c, "Model Jev picked").value, "Model not previewed (route preview is not set up)")
})

test("unpriced model: cost reads 'no dollar estimate', never $0", () => {
  const c = card({ route: { ...ROUTE, estimatedCostUsd: null }, routeReason: null })
  assert.equal(rowOf(c, "Model cost (estimate)").value, "no dollar estimate")
  assert.ok(c.routeBasis.includes("no listed price"))
})

test("malformed stored route is treated as no route, with its reason", () => {
  const c = card({ route: { model: "", provider: "p", routeId: "r" }, routeReason: "bad_response" })
  assert.equal(c.route, null)
  assert.equal(rowOf(c, "Model Jev picked").value, "Model not previewed (gateway reply was not understood)")
})

test("the existing card fields and the gate's own estimate are unchanged", () => {
  const c = card({ route: ROUTE, routeReason: null })
  assert.equal(c.estimatedLabel, "$2.50")
  assert.equal(c.status, "pending")
  assert.equal(c.canDecide, true)
  assert.equal(c.target, "https://seller.example/api")
})

test("parseApprovalRoute accepts missing optional fields and rejects missing required ones", () => {
  assert.equal(parseApprovalRoute(null), null)
  assert.equal(parseApprovalRoute({ ...ROUTE, routeId: undefined }), null)
  const p = parseApprovalRoute({ model: "m", provider: "p", routeId: "r" })
  assert.equal(p.tier, null)
  assert.equal(p.estimatedCostUsd, null)
  assert.equal(p.jevConfidence, null)
})

test("formatUsd: small amounts keep four decimals; invalid input is not $0", () => {
  assert.equal(formatUsd(0.00042), "$0.0004")
  assert.equal(formatUsd(1.5), "$1.50")
  assert.equal(formatUsd(null), "no dollar estimate")
  assert.equal(formatUsd(Number.NaN), "no dollar estimate")
  assert.equal(formatUsd(-1), "no dollar estimate")
})

test("routeSection with no route gives no basis line", () => {
  assert.deepEqual(routeSection(null, "rate_limited").rows[0].value, "Model not previewed (preview is rate limited)")
  assert.equal(routeSection(null, null).basis, null)
})
