// Route preview client (Shipyard /v1/route): typed failures, no unauthenticated fallback, response validation.
// Run: node --test test/route-preview.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  approvalRouteFields,
  parseRouteResponse,
  previewRoute,
  DEFAULT_ROUTE_URL,
} from "../lib/route-preview.ts"

const MESSAGES = [{ role: "user", content: "hi there" }]
const KEY = "test-route-key-not-real"
const ENV = { SHIPYARD_ROUTE_KEY: KEY, SHIPYARD_ROUTE_URL: "http://127.0.0.1:9/v1/route" }
const GOOD = {
  model: "fast-model",
  provider: "prov-a",
  tier: "low",
  tier_source: "jev",
  tier_decided: "low",
  clamped: false,
  jev_confidence: 0.82,
  estimated_cost_usd: 0.00042,
  estimate_basis: "120 input tokens estimated from the request text",
  route_id: "rte_abc123",
}

/** Records every call and answers with the given response factory. */
function mockFetch(respond) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { fetchImpl, calls }
}
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

test("missing key returns not_configured and makes no network call", async () => {
  for (const env of [{}, { SHIPYARD_ROUTE_KEY: "" }, { SHIPYARD_ROUTE_KEY: "   " }]) {
    const { fetchImpl, calls } = mockFetch(() => json(200, GOOD))
    const r = await previewRoute(MESSAGES, { env, fetchImpl })
    assert.deepEqual(r, { ok: false, reason: "not_configured" })
    assert.equal(calls.length, 0)
  }
})

test("default URL is the production route; env override is used when set", async () => {
  const seen = []
  const f = async (url) => {
    seen.push(url)
    return json(200, GOOD)
  }
  await previewRoute(MESSAGES, { env: { SHIPYARD_ROUTE_KEY: KEY }, fetchImpl: f })
  await previewRoute(MESSAGES, { env: ENV, fetchImpl: f })
  assert.equal(seen[0], DEFAULT_ROUTE_URL)
  assert.equal(seen[1], "http://127.0.0.1:9/v1/route")
})

test("request is an authenticated POST with model auto and the messages", async () => {
  const { fetchImpl, calls } = mockFetch(() => json(200, GOOD))
  await previewRoute(MESSAGES, { env: ENV, fetchImpl })
  const { init } = calls[0]
  assert.equal(init.method, "POST")
  assert.equal(init.headers.authorization, `Bearer ${KEY}`)
  assert.deepEqual(JSON.parse(init.body), { model: "auto", messages: MESSAGES })
})

test("a successful response is parsed into the route payload with previewedAt", async () => {
  const { fetchImpl } = mockFetch(() => json(200, GOOD))
  const r = await previewRoute(MESSAGES, {
    env: ENV,
    fetchImpl,
    now: () => new Date("2026-10-22T12:00:00.000Z"),
  })
  assert.equal(r.ok, true)
  assert.equal(r.route.model, "fast-model")
  assert.equal(r.route.provider, "prov-a")
  assert.equal(r.route.tier, "low")
  assert.equal(r.route.estimatedCostUsd, 0.00042)
  assert.equal(r.route.routeId, "rte_abc123")
  assert.equal(r.route.jevConfidence, 0.82)
  assert.equal(r.previewedAt, "2026-10-22T12:00:00.000Z")
})

test("401, 422, 429 map to typed reasons; other statuses map to bad_request or http_error", async () => {
  const cases = [
    [401, "unauthorized"],
    [422, "no_capable_model"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [500, "http_error"],
    [503, "http_error"],
  ]
  for (const [status, reason] of cases) {
    const { fetchImpl } = mockFetch(() => json(status, { error: "x" }))
    const r = await previewRoute(MESSAGES, { env: ENV, fetchImpl })
    assert.deepEqual(r, { ok: false, reason }, `status ${status}`)
  }
})

test("a fetch that never settles returns timeout within the budget", async () => {
  const { fetchImpl, calls } = mockFetch(() => new Promise(() => {}))
  const started = Date.now()
  const r = await previewRoute(MESSAGES, { env: ENV, fetchImpl, timeoutMs: 50 })
  assert.deepEqual(r, { ok: false, reason: "timeout" })
  assert.ok(Date.now() - started < 1000)
  assert.equal(calls[0].init.signal.aborted, true)
})

test("a fetch that ignores the abort signal still times out", async () => {
  const f = () => new Promise((resolve) => setTimeout(() => resolve(json(200, GOOD)), 2000))
  const r = await previewRoute(MESSAGES, { env: ENV, fetchImpl: f, timeoutMs: 30 })
  assert.deepEqual(r, { ok: false, reason: "timeout" })
})

test("a network failure returns network_error and never throws", async () => {
  const f = async () => {
    throw new TypeError("fetch failed")
  }
  const r = await previewRoute(MESSAGES, { env: ENV, fetchImpl: f })
  assert.deepEqual(r, { ok: false, reason: "network_error" })
})

test("malformed responses are rejected as bad_response", async () => {
  const bad = [
    ["not json", new Response("<html>", { status: 200 })],
    ["array", json(200, [])],
    ["missing model", json(200, { ...GOOD, model: undefined })],
    ["empty provider", json(200, { ...GOOD, provider: "  " })],
    ["cost as string", json(200, { ...GOOD, estimated_cost_usd: "0.1" })],
    ["cost missing", json(200, { ...GOOD, estimated_cost_usd: undefined })],
    ["cost NaN-like", json(200, { ...GOOD, estimated_cost_usd: null, jev_confidence: "high" })],
    ["basis not string", json(200, { ...GOOD, estimate_basis: 3 })],
    ["no route id", json(200, { ...GOOD, route_id: undefined })],
    ["tier number", json(200, { ...GOOD, tier: 2 })],
  ]
  for (const [name, res] of bad) {
    const { fetchImpl } = mockFetch(() => res)
    const r = await previewRoute(MESSAGES, { env: ENV, fetchImpl })
    assert.deepEqual(r, { ok: false, reason: "bad_response" }, name)
  }
})

test("null cost (unpriced model) and null tier are valid, not failures", () => {
  const parsed = parseRouteResponse({ ...GOOD, estimated_cost_usd: null, tier: null, jev_confidence: null })
  assert.equal(parsed.estimatedCostUsd, null)
  assert.equal(parsed.tier, null)
  assert.equal(parsed.jevConfidence, null)
})

test("the key never appears in a failure result", async () => {
  const f = async () => {
    throw new Error(`boom ${KEY}`)
  }
  const r = await previewRoute(MESSAGES, { env: ENV, fetchImpl: f })
  assert.ok(!JSON.stringify(r).includes(KEY))
})

test("approvalRouteFields stores route data on success", () => {
  const f = approvalRouteFields({
    ok: true,
    previewedAt: "2026-10-22T12:00:00.000Z",
    route: {
      model: "fast-model",
      provider: "prov-a",
      tier: "low",
      estimatedCostUsd: 0.00042,
      estimateBasis: "basis",
      routeId: "rte_1",
      jevConfidence: 0.8,
    },
  })
  assert.deepEqual(f, {
    route: {
      model: "fast-model",
      provider: "prov-a",
      tier: "low",
      estimatedCostUsd: 0.00042,
      estimateBasis: "basis",
      routeId: "rte_1",
      jevConfidence: 0.8,
      previewedAt: "2026-10-22T12:00:00.000Z",
    },
    routeReason: null,
  })
})

test("approvalRouteFields stores a reason and null route on failure", () => {
  assert.deepEqual(approvalRouteFields({ ok: false, reason: "timeout" }), { route: null, routeReason: "timeout" })
})
