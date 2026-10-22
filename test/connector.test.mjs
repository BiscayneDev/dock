// Dinghy connector (Dock side). Run: node --test test/connector.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CONNECTOR_APPROVAL_TTL_MS,
  CONNECTOR_PAIRING_TTL_MS,
  approvalDetailsHash,
  authenticateConnectorToken,
  decisionRefusal,
  formatConnectorToken,
  hashConnectorCode,
  hashConnectorSecret,
  newConnectorPairingCode,
  newConnectorSalt,
  newConnectorSecret,
  normalizeConnectorCode,
  parseConnectorToken,
  verifyConnectorSecret,
} from "../lib/connector-rules.ts"
import { sendConnectorEvent, signConnectorPayload, webhookUrlAllowed, clipRunText } from "../lib/connector-webhook.ts"
import {
  hashDeviceSecret,
  hashPairingCode,
  newDeviceSecret,
  formatDeviceToken,
  parseDeviceToken,
  normalizePairingCode,
} from "../lib/device-rules.ts"
import { verifyDockSignature } from "./fixtures/dinghy-hmac.mjs"

const CONN_ID = "6f1c2a3e-9b8d-4e7f-8a6b-0c1d2e3f4a5b"
const WS_ID = "7a2d3b4f-0c9e-4f80-9b7c-1d2e3f4a5b6c"
const LINK_REF = "link_ref_0123456789abcdef"

function enrolled() {
  const salt = newConnectorSalt()
  const secret = newConnectorSecret()
  const row = {
    id: CONN_ID,
    workspace_id: WS_ID,
    owner_id: "8b3e4c5d-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    link_ref: LINK_REF,
    token_salt: salt,
    token_hash: hashConnectorSecret(salt, secret),
    revoked_at: null,
  }
  return { row, token: formatConnectorToken(CONN_ID, secret), secret, salt }
}

// ── Tokens and pairing codes ──────────────────────────────────────────────────

test("connector token: format round-trips and malformed shapes are rejected", () => {
  const { token } = enrolled()
  assert.match(token, /^dockcon\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(parseConnectorToken(token)?.connectionId, CONN_ID)
  assert.equal(parseConnectorToken("dockdev." + CONN_ID + ".x".repeat(30)), null)
  assert.equal(parseConnectorToken("dockcon.not-a-uuid." + "x".repeat(30)), null)
  assert.equal(parseConnectorToken(null), null)
})

test("connector token hash lookup: valid token authenticates, others do not", () => {
  const { row, token, secret } = enrolled()
  const ok = authenticateConnectorToken(token, row)
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.workspaceId, WS_ID)

  assert.deepEqual(authenticateConnectorToken(null, row), { ok: false, reason: "missing" })
  assert.deepEqual(authenticateConnectorToken("garbage", row), { ok: false, reason: "malformed" })
  assert.deepEqual(authenticateConnectorToken(token, null), { ok: false, reason: "unknown" })
  assert.deepEqual(authenticateConnectorToken(token, { ...row, revoked_at: "2026-10-01T00:00:00Z" }), {
    ok: false,
    reason: "revoked",
  })
  assert.deepEqual(authenticateConnectorToken(token, { ...row, token_hash: null }), { ok: false, reason: "not_paired" })
  const wrong = formatConnectorToken(CONN_ID, newConnectorSecret())
  assert.deepEqual(authenticateConnectorToken(wrong, row), { ok: false, reason: "bad_secret" })
  assert.equal(verifyConnectorSecret(row.token_salt, secret, row.token_hash), true)
})

test("connector hashing is the same scheme as devices (sha256 salt:secret, same pairing hash)", () => {
  const salt = "0123456789abcdef0123456789abcdef"
  const secret = "A".repeat(43)
  assert.equal(hashConnectorSecret(salt, secret), hashDeviceSecret(salt, secret))
  assert.equal(hashConnectorCode("ABCD-EFGH"), hashPairingCode("ABCD-EFGH"))
  assert.equal(normalizeConnectorCode("abcd-efgh"), normalizePairingCode("abcd-efgh"))
  assert.equal(normalizeConnectorCode("ABCD-EF0H"), null) // 0 is not in the alphabet
  assert.equal(normalizeConnectorCode("ABCD"), null)
  // A device token must not authenticate as a connector and vice versa.
  const devTok = formatDeviceToken(CONN_ID, newDeviceSecret())
  assert.equal(parseConnectorToken(devTok), null)
  assert.equal(parseDeviceToken(formatConnectorToken(CONN_ID, "x".repeat(43))), null)
})

test("pairing code: 8 chars in XXXX-XXXX form, 10-minute TTL", () => {
  assert.match(newConnectorPairingCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/)
  assert.equal(CONNECTOR_PAIRING_TTL_MS, 600_000)
  assert.equal(CONNECTOR_APPROVAL_TTL_MS, 900_000)
})

// ── Decisions ──────────────────────────────────────────────────────────────────

const DETAILS = { actionId: "act-1", type: "transfer", amountCents: 2500, destination: "acct-9", description: "Pay vendor" }

test("decide refused for expired, non-pending, and changed-details approvals", () => {
  const hash = approvalDetailsHash(DETAILS)
  const now = Date.parse("2026-10-22T12:00:00Z")
  const base = { status: "pending", expiresAt: new Date(now + 60_000).toISOString(), now, storedHash: hash, expectedHash: hash, currentHash: hash }

  assert.equal(decisionRefusal(base), null)
  assert.equal(decisionRefusal({ ...base, expiresAt: new Date(now - 1).toISOString() }), "expired")
  assert.equal(decisionRefusal({ ...base, expiresAt: new Date(now).toISOString() }), "expired")
  assert.equal(decisionRefusal({ ...base, status: "approved" }), "not_pending")
  assert.equal(decisionRefusal({ ...base, status: "rejected", expiresAt: new Date(now - 1).toISOString() }), "not_pending")
  assert.equal(decisionRefusal({ ...base, expectedHash: "f".repeat(64) }), "changed")
  const changed = approvalDetailsHash({ ...DETAILS, amountCents: 99999 })
  assert.equal(decisionRefusal({ ...base, currentHash: changed }), "changed")
  assert.equal(decisionRefusal({ ...base, currentHash: null }), "changed")
})

test("approval details hash is stable and sensitive to every shown field", () => {
  const h = approvalDetailsHash(DETAILS)
  assert.equal(h, approvalDetailsHash({ ...DETAILS }))
  assert.notEqual(h, approvalDetailsHash({ ...DETAILS, destination: "acct-10" }))
  assert.notEqual(h, approvalDetailsHash({ ...DETAILS, description: "Pay other" }))
  assert.notEqual(h, approvalDetailsHash({ ...DETAILS, actionId: "act-2" }))
  assert.match(h, /^[0-9a-f]{64}$/)
})

// ── Webhook ────────────────────────────────────────────────────────────────────

const SECRET = "f".repeat(64)

function captureFetch() {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response("{}", { status: 200 })
  }
  return { calls, fetchImpl }
}

test("webhook signature verifies with Dinghy's receiver algorithm (fixture copied from Dinghy)", async () => {
  const { calls, fetchImpl } = captureFetch()
  const now = Math.floor(Date.now() / 1000)
  const outcome = await sendConnectorEvent({
    secret: SECRET,
    url: "https://getdinghy.sh/api/dock/webhook",
    linkRef: LINK_REF,
    workspaceId: WS_ID,
    type: "approval.requested",
    data: { approval_id: "ap-1", label: "transfer", action: "Pay vendor", details_hash: approvalDetailsHash(DETAILS), expires_at: new Date(now * 1000 + CONNECTOR_APPROVAL_TTL_MS).toISOString() },
    nowSeconds: now,
    fetchImpl,
    eventId: "evt-1",
  })
  assert.equal(outcome, "sent")
  assert.equal(calls.length, 1)
  const { headers, body, redirect } = calls[0].init
  assert.equal(redirect, "error")
  const parsed = JSON.parse(body)
  assert.equal(parsed.event_id, "evt-1")
  assert.equal(parsed.type, "approval.requested")
  assert.equal(parsed.link_ref, LINK_REF)
  assert.equal(parsed.workspace_id, WS_ID)

  const check = verifyDockSignature({
    secret: SECRET,
    timestamp: headers["x-dinghy-timestamp"],
    signature: headers["x-dinghy-signature"],
    rawBody: body,
    nowSeconds: now,
  })
  assert.deepEqual(check, { ok: true })
  assert.equal(headers["x-dinghy-signature"], signConnectorPayload(SECRET, now, body))
})

test("receiver rejects a tampered body, a wrong secret, and a stale timestamp", async () => {
  const { calls, fetchImpl } = captureFetch()
  const now = Math.floor(Date.now() / 1000)
  await sendConnectorEvent({ secret: SECRET, url: "https://getdinghy.sh/api/dock/webhook", linkRef: LINK_REF, workspaceId: WS_ID, type: "run.update", data: { text: "hi" }, nowSeconds: now, fetchImpl })
  const { headers, body } = calls[0].init
  const base = { timestamp: headers["x-dinghy-timestamp"], signature: headers["x-dinghy-signature"], nowSeconds: now }
  assert.equal(verifyDockSignature({ ...base, secret: SECRET, rawBody: body.replace("hi", "bye") }).ok, false)
  assert.equal(verifyDockSignature({ ...base, secret: "e".repeat(64), rawBody: body }).ok, false)
  assert.deepEqual(verifyDockSignature({ ...base, secret: SECRET, rawBody: body, nowSeconds: now + 301 }), { ok: false, reason: "stale" })
  assert.deepEqual(verifyDockSignature({ ...base, secret: SECRET, rawBody: body, nowSeconds: now + 300 }), { ok: true })
})

test("unsigned send is refused when the secret is missing or blank", async () => {
  for (const secret of [undefined, "", "   "]) {
    const { calls, fetchImpl } = captureFetch()
    const outcome = await sendConnectorEvent({ secret, url: "https://getdinghy.sh/api/dock/webhook", linkRef: LINK_REF, workspaceId: WS_ID, type: "run.update", data: {}, fetchImpl })
    assert.equal(outcome, "no_secret")
    assert.equal(calls.length, 0, "nothing must be sent without a secret")
  }
})

test("webhook URL must be https (localhost excepted) and a failed send does not throw", async () => {
  assert.equal(webhookUrlAllowed("https://getdinghy.sh/api/dock/webhook"), true)
  assert.equal(webhookUrlAllowed("http://localhost:3000/api/dock/webhook"), true)
  assert.equal(webhookUrlAllowed("http://getdinghy.sh/api/dock/webhook"), false)
  assert.equal(webhookUrlAllowed("not a url"), false)
  const { calls, fetchImpl } = captureFetch()
  const out = await sendConnectorEvent({ secret: SECRET, url: "http://getdinghy.sh/x", linkRef: LINK_REF, workspaceId: WS_ID, type: "run.update", data: {}, fetchImpl })
  assert.equal(out, "bad_url")
  assert.equal(calls.length, 0)
  const boom = await sendConnectorEvent({ secret: SECRET, url: "https://getdinghy.sh/api/dock/webhook", linkRef: LINK_REF, workspaceId: WS_ID, type: "run.update", data: {}, fetchImpl: async () => new Response("", { status: 500 }) })
  assert.equal(boom, "failed")
})

test("run text is clipped to 900 characters", () => {
  assert.equal(clipRunText("a".repeat(2000)).length, 900)
  assert.equal(clipRunText("  short  "), "short")
})
