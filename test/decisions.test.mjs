// Decision rules: artifact hash binding, refusal order, verdict/status mapping, request validation.
// Run: node --test test/decisions.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  artifactHash,
  canonicalJson,
  decisionRefusal,
  isExpired,
  isPending,
  normalizeOptions,
  planVerdict,
  reviewerIsProducer,
  runApprovalArtifact,
  validateDecisionRequest,
  verdictStatus,
} from "../lib/decisions.ts"

const NOW = Date.parse("2026-11-24T12:00:00.000Z")

test("artifactHash is deterministic and ignores object key order", () => {
  const a = artifactHash({ b: 2, a: 1, nested: { z: 26, y: 25 }, list: [1, 2, 3] })
  const b = artifactHash({ nested: { y: 25, z: 26 }, list: [1, 2, 3], a: 1, b: 2 })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, artifactHash({ a: 1, b: 3 }))
})

test("canonicalJson sorts keys but keeps array order", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}')
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]")
  assert.equal(canonicalJson(undefined), "null")
})

test("runApprovalArtifact reads the latest approval_requested event with fixed fields", () => {
  const events = [
    { kind: "approval_requested", data: { actionId: "old", type: "x402_spend", amountCents: 1 } },
    {
      kind: "approval_requested",
      data: {
        actionId: "act-9",
        type: "x402_spend",
        amountCents: 250,
        destination: "https://seller.example/api",
        description: "Buy the dataset",
      },
    },
  ]
  const artifact = runApprovalArtifact({ payload: {}, events })
  assert.equal(artifact.actionId, "act-9")
  assert.equal(artifact.amountCents, 250)
  assert.equal(artifactHash(artifact), artifactHash({
    actionId: "act-9",
    type: "x402_spend",
    amountCents: 250,
    destination: "https://seller.example/api",
    description: "Buy the dataset",
  }))
})

test("runApprovalArtifact falls back to the payload proposed action", () => {
  const artifact = runApprovalArtifact({
    payload: { proposedAction: { id: "p1", type: "moonpay_refund", amountCents: 7 } },
    events: [],
  })
  assert.equal(artifact.actionId, "p1")
  assert.equal(artifact.type, "moonpay_refund")
  assert.equal(runApprovalArtifact({ payload: {}, events: [] }), null)
})

test("decisionRefusal order: not_pending beats expired beats changed", () => {
  const base = {
    expiresAt: new Date(NOW - 1000).toISOString(),
    now: NOW,
    storedHash: "a".repeat(64),
    expectedHash: "b".repeat(64),
    currentHash: "c".repeat(64),
  }
  assert.equal(decisionRefusal({ ...base, status: "approved" }), "not_pending")
  assert.equal(
    decisionRefusal({
      ...base,
      status: "snoozed",
      expiresAt: new Date(NOW + 1000).toISOString(),
      expectedHash: "a".repeat(64),
      currentHash: "a".repeat(64),
    }),
    null,
  )
  assert.equal(
    decisionRefusal({ ...base, status: "pending", expiresAt: new Date(NOW + 1000).toISOString() }),
    "changed",
  )
  assert.equal(
    decisionRefusal({
      ...base,
      status: "pending",
      expectedHash: "a".repeat(64),
      currentHash: "a".repeat(64),
    }),
    "expired",
  )
  assert.equal(
    decisionRefusal({
      status: "pending",
      expiresAt: null,
      now: NOW,
      storedHash: "a".repeat(64),
      expectedHash: "a".repeat(64),
      currentHash: "a".repeat(64),
    }),
    null,
  )
})

test("verdictStatus maps every verdict", () => {
  assert.equal(verdictStatus("approve"), "approved")
  assert.equal(verdictStatus("request_changes"), "changes_requested")
  assert.equal(verdictStatus("edit_accept"), "edited_accepted")
  assert.equal(verdictStatus("reassign"), "reassigned")
  assert.equal(verdictStatus("escalate"), "escalated")
  assert.equal(verdictStatus("answer"), "answered")
  assert.equal(verdictStatus("snooze"), "snoozed")
})

test("planVerdict requires a reason for changes_requested and text for answer", () => {
  assert.equal(planVerdict({ verdict: "approve" }).ok, true)
  const noReason = planVerdict({ verdict: "request_changes" })
  assert.equal(noReason.ok, false)
  assert.equal(planVerdict({ verdict: "request_changes", reason: "  needs tests  " }).reason, "needs tests")
  const noAnswer = planVerdict({ verdict: "answer" })
  assert.equal(noAnswer.ok, false)
  assert.equal(planVerdict({ verdict: "answer", note: "done" }).status, "answered")
  assert.equal(planVerdict({ verdict: "nope" }).ok, false)
})

test("validateDecisionRequest computes the hash server-side and rejects malformed input", () => {
  const ok = validateDecisionRequest({
    kind: "question",
    title: "Which dataset?",
    artifactRef: "draft:42",
    artifact: { draft: 42, b: [2, 1], a: 1 },
    options: [{ id: "a", label: "A" }],
    expiresAt: "2026-11-25T00:00:00.000Z",
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.value.kind, "question")
    assert.equal(ok.value.artifactHash, artifactHash({ draft: 42, b: [2, 1], a: 1 }))
    assert.equal(ok.value.expiresAt, "2026-11-25T00:00:00.000Z")
  }

  assert.equal(validateDecisionRequest(null).ok, false)
  assert.equal(validateDecisionRequest({ title: "" }).error, "title is required")
  assert.equal(validateDecisionRequest({ title: "x", kind: "other" }).error, "invalid kind")
  assert.equal(validateDecisionRequest({ title: "x" }).error, "artifactRef is required")
  assert.equal(
    validateDecisionRequest({ title: "x", artifactRef: "r", options: [{ id: "", label: "L" }] }).error,
    "options must be a list of {id,label}",
  )
  assert.equal(
    validateDecisionRequest({ title: "x", artifactRef: "r", expiresAt: "not-a-date" }).error,
    "expiresAt is not a valid date",
  )
  // An explicit artifact wins over a bare ref for hashing.
  const both = validateDecisionRequest({ title: "x", artifactRef: "r", artifact: { a: 1 } })
  assert.equal(both.ok && both.value.artifactHash === artifactHash({ a: 1 }), true)
})

test("normalizeOptions trims, drops nothing silently, and enforces bounds", () => {
  assert.deepEqual(normalizeOptions(undefined), [])
  assert.deepEqual(normalizeOptions([{ id: " a ", label: " A " }]), [{ id: "a", label: "A" }])
  assert.equal(normalizeOptions("nope"), null)
  assert.equal(normalizeOptions([{ id: "a" }]), null)
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }))
  assert.equal(normalizeOptions(many), null)
})

test("isPending/isExpired/reviewer rules", () => {
  assert.equal(isPending("pending"), true)
  assert.equal(isPending("snoozed"), true)
  assert.equal(isPending("approved"), false)
  assert.equal(isExpired(null, NOW), false)
  assert.equal(isExpired(new Date(NOW - 1).toISOString(), NOW), true)
  assert.equal(reviewerIsProducer("u1", "u1"), true)
  assert.equal(reviewerIsProducer("u1", null), false)
})
