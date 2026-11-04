// Pairing: expiring single-use codes, device credentials, per-device revocation,
// atomic consume under concurrency, and bounded failure attempts.
// Store semantics are tested against the in-memory store, which serializes its
// critical section the same way the Postgres exchange_mobile_pairing function
// locks the pairing row (migration 20261104_mobile_pairings).
// Run: node --experimental-strip-types --test test/mobile-pairing.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

const {
  createPairingCode, exchangePairingCode, deviceTokenAuthorized, listDevices, revokeDevice,
  PairingError, memoryMobilePairingStore, PAIR_MAX_FAILURES,
} = await import("../lib/mobile-pairing.ts")

const WS = "ws-test"

test("pairing: one code mints one device, then dies", async () => {
  const store = memoryMobilePairingStore()
  const { code, expiresAt } = await createPairingCode(store, WS)
  assert.match(code, /^\d{6}$/)
  assert.ok(expiresAt > Date.now())

  const { deviceToken, deviceId } = await exchangePairingCode(store, WS, code, "ios", "Test Phone")
  assert.ok(deviceToken.startsWith("dockdev_"))
  assert.equal(await deviceTokenAuthorized(store, deviceToken), true)

  await assert.rejects(() => exchangePairingCode(store, WS, code, "ios"), PairingError)
  await assert.rejects(() => exchangePairingCode(store, WS, "000000", "ios"), PairingError)

  const devices = await listDevices(store, WS)
  assert.equal(devices.length, 1)
  assert.equal(devices[0].deviceLabel, "Test Phone")
  assert.equal(devices[0].tokenHash, undefined, "list never exposes the token hash")
})

test("concurrent exchanges of one code mint exactly one credential", async () => {
  const store = memoryMobilePairingStore()
  const { code } = await createPairingCode(store, WS)
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => exchangePairingCode(store, WS, code, "ios")),
  )
  const won = results.filter((r) => r.status === "fulfilled")
  assert.equal(won.length, 1, "exactly one exchange wins the code")
  assert.equal((await listDevices(store, WS)).length, 1)
})

test("failed exchanges are bounded: rate_limited after the window fills", async () => {
  const store = memoryMobilePairingStore()
  const { code } = await createPairingCode(store, WS)
  for (let i = 0; i < PAIR_MAX_FAILURES; i++) {
    await assert.rejects(() => exchangePairingCode(store, WS, "999999", "ios"), /invalid or expired/)
  }
  // The next attempt - even with the CORRECT code - is refused until the window passes.
  await assert.rejects(
    () => exchangePairingCode(store, WS, code, "ios"),
    (err) => err instanceof PairingError && err.outcome === "rate_limited",
  )
})

test("revoked devices stop authorizing; double revoke is a no-op", async () => {
  const store = memoryMobilePairingStore()
  const { code } = await createPairingCode(store, WS)
  const { deviceToken, deviceId } = await exchangePairingCode(store, WS, code, "ios")
  assert.equal(await revokeDevice(store, WS, deviceId), true)
  assert.equal(await revokeDevice(store, WS, deviceId), false)
  assert.equal(await deviceTokenAuthorized(store, deviceToken), false)
  // A revoked device cannot be revived by a different workspace id
  assert.equal((await listDevices(store, WS)).length, 1)
  assert.equal((await listDevices(store, "ws-other")).length, 0)
})

test("expired codes are refused", async () => {
  const store = memoryMobilePairingStore()
  const { code } = await createPairingCode(store, WS)
  // Wait-free expiry: create a code whose TTL has passed by manipulating time.
  const past = new Date(Date.now() - 1000)
  await store.createPairing(WS, (await import("../lib/mobile-pairing.ts")).hashMobileSecret("123456"), past)
  await assert.rejects(() => exchangePairingCode(store, WS, "123456", "ios"), /invalid or expired/)
})
