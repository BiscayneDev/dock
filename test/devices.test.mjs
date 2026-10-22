// Device (home node) rules: pairing codes, token hashing, freshness, auth, completion transitions, and the
// money-list parity between the server and the daemon. Run: node --test test/devices.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  allowedDeviceCompletion,
  authenticateDeviceToken,
  formatDeviceToken,
  hashDeviceSecret,
  hashPairingCode,
  isDeviceEventKind,
  isDeviceOnline,
  newDeviceSalt,
  newDeviceSecret,
  newPairingCode,
  normalizePairingCode,
  pairingRedeemable,
  parseDeviceToken,
  DEVICE_FRESH_MS,
} from "../lib/device-rules.ts"
import { MONEY_ACTION_TYPES } from "../lib/task-runs.ts"

const DEVICE_ID = "6f1c2a3e-9b8d-4e7f-8a6b-0c1d2e3f4a5b"

function enrolled() {
  const salt = newDeviceSalt()
  const secret = newDeviceSecret()
  const row = {
    id: DEVICE_ID,
    workspace_id: "ws-1",
    owner_id: "owner-1",
    name: "laptop",
    token_salt: salt,
    token_hash: hashDeviceSecret(salt, secret),
    revoked_at: null,
    last_seen_at: new Date().toISOString(),
  }
  return { row, token: formatDeviceToken(DEVICE_ID, secret), secret, salt }
}

test("pairing code: single-use semantics and 10-minute expiry", () => {
  const code = newPairingCode()
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, "XXXX-XXXX from the unambiguous alphabet")
  assert.equal(normalizePairingCode(code.toLowerCase().replace("-", " ")), code.replace("-", ""))
  assert.equal(normalizePairingCode("ABCD-EFG"), null, "too short")
  assert.equal(normalizePairingCode("ABC0-EFGH"), null, "0 is not in the alphabet")
  const now = Date.now()
  assert.equal(pairingRedeemable({ expiresAt: new Date(now + 60_000), usedAt: null }, now), true)
  assert.equal(pairingRedeemable({ expiresAt: new Date(now + 60_000), usedAt: new Date(now) }, now), false, "used code")
  assert.equal(pairingRedeemable({ expiresAt: new Date(now - 1), usedAt: null }, now), false, "expired code")
  assert.equal(hashPairingCode(code), hashPairingCode(code.toLowerCase()), "hash is over the normalized code")
})

test("device token: stored as sha256(salt:secret); only the matching secret authenticates", () => {
  const { row, token, secret, salt } = enrolled()
  assert.notEqual(row.token_hash, secret, "the secret is never the stored value")
  assert.equal(row.token_hash.length, 64)
  assert.equal(hashDeviceSecret(salt, secret), row.token_hash)
  const ok = authenticateDeviceToken(token, row)
  assert.equal(ok.ok, true)
  assert.equal(ok.ownerId, "owner-1")
  assert.equal(ok.workspaceId, "ws-1")

  const wrong = token.slice(0, -4) + "AAAA"
  assert.deepEqual(authenticateDeviceToken(wrong, row), { ok: false, reason: "bad_secret" })
  const otherSalt = { ...row, token_salt: newDeviceSalt() }
  assert.equal(authenticateDeviceToken(token, otherSalt).ok, false, "a different salt does not verify")
})

test("device token: malformed, missing and unknown tokens are refused", () => {
  const { row, token } = enrolled()
  assert.deepEqual(authenticateDeviceToken(null, row), { ok: false, reason: "missing" })
  assert.deepEqual(authenticateDeviceToken("not-a-token", row), { ok: false, reason: "malformed" })
  assert.equal(parseDeviceToken("dockdev.nope.x"), null)
  assert.deepEqual(authenticateDeviceToken(token, null), { ok: false, reason: "unknown" })
  const other = { ...row, id: "00000000-0000-4000-8000-000000000000" }
  assert.deepEqual(authenticateDeviceToken(token, other), { ok: false, reason: "unknown" }, "id must match the row")
})

test("revoked device gets 'revoked' (the endpoints answer 401)", () => {
  const { row, token } = enrolled()
  const revoked = { ...row, revoked_at: new Date().toISOString() }
  assert.deepEqual(authenticateDeviceToken(token, revoked), { ok: false, reason: "revoked" })
})

test("unpaired device (no token hash yet) cannot authenticate", () => {
  const { row, token } = enrolled()
  assert.deepEqual(authenticateDeviceToken(token, { ...row, token_hash: null, token_salt: null }), {
    ok: false,
    reason: "not_paired",
  })
})

test("freshness: a device with a stale heartbeat is offline and gets no claims", () => {
  const now = Date.now()
  assert.equal(isDeviceOnline(new Date(now - 30_000).toISOString(), now), true)
  assert.equal(isDeviceOnline(new Date(now - DEVICE_FRESH_MS - 1000).toISOString(), now), false, "older than 2 minutes")
  assert.equal(isDeviceOnline(null, now), false)
  assert.equal(isDeviceOnline(new Date(now + 10 * 60_000).toISOString(), now), false, "far-future clock is not trusted")
})

test("device event kinds: only the whitelisted kinds are accepted from a device", () => {
  assert.equal(isDeviceEventKind("started"), true)
  assert.equal(isDeviceEventKind("action_refused"), true)
  assert.equal(isDeviceEventKind("approval_granted"), false, "a device cannot grant approval")
  assert.equal(isDeviceEventKind("completed"), false, "completion goes through the complete route")
  assert.equal(isDeviceEventKind(42), false)
})

test("completion transitions: only leased or running runs move, to the allowed statuses", () => {
  assert.equal(allowedDeviceCompletion("leased", "succeeded"), true)
  assert.equal(allowedDeviceCompletion("running", "awaiting_approval"), true)
  assert.equal(allowedDeviceCompletion("queued", "succeeded"), false, "queued runs are not held")
  assert.equal(allowedDeviceCompletion("succeeded", "failed"), false, "terminal runs do not change")
  assert.equal(allowedDeviceCompletion("leased", "queued"), false, "a device cannot requeue")
})

test("money list: the daemon's copy matches the server's MONEY_ACTION_TYPES", async () => {
  const daemon = await import("../node/dock-node/src/money.mjs")
  assert.deepEqual([...daemon.MONEY_ACTION_TYPES].sort(), [...MONEY_ACTION_TYPES].sort())
})

test("migration: the cloud claim is limited to target 'cloud' and home claims are device-scoped", async () => {
  const sql = await readFile(new URL("../db/migrations/0006_devices.sql", import.meta.url), "utf8")
  assert.match(sql, /q\.status = 'queued' and q\.target = 'cloud'/)
  assert.match(sql, /q\.target = 'home'\s+and q\.owner_id = d\.owner_id/)
  assert.match(sql, /d\.last_seen_at < now\(\) - interval '120 seconds'/)
  assert.doesNotMatch(sql, /grant execute[^;]*(anon|authenticated)/i, "device RPCs are service-role only")
})
