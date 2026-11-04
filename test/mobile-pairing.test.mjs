// Pairing: expiring single-use codes, device credentials, per-device revocation.
// Run: node --experimental-strip-types --test test/mobile-pairing.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { createPairingCode, exchangePairingCode, deviceTokenAuthorized, listDevices, revokeDevice, PairingError } = await import("../lib/mobile-pairing.ts")

async function files(t) {
  const dir = await mkdtemp(join(tmpdir(), "dock-pair-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { codes: join(dir, "pairing-codes.json"), devices: join(dir, "mobile-devices.json") }
}

test("pairing: one code mints one device, then dies", async (t) => {
  const f = await files(t)
  const { code, expiresAt } = await createPairingCode(f.codes)
  assert.match(code, /^\d{6}$/)
  assert.ok(expiresAt > Date.now())

  const { deviceToken, deviceId } = await exchangePairingCode(code, "ios", "Halsey's iPhone", f.codes, f.devices)
  assert.ok(deviceToken.startsWith("dockdev_"))
  assert.equal(await deviceTokenAuthorized(deviceToken, f.devices), true)

  // single use
  await assert.rejects(() => exchangePairingCode(code, "ios", undefined, f.codes, f.devices), PairingError)
  // unknown code
  await assert.rejects(() => exchangePairingCode("000000", "ios", undefined, f.codes, f.devices), PairingError)

  const devices = await listDevices(f.devices)
  assert.equal(devices.length, 1)
  assert.equal(devices[0].deviceLabel, "Halsey's iPhone")
  assert.equal(devices[0].tokenHash, undefined, "list never exposes the token hash")
})

test("expired codes are refused", async (t) => {
  const f = await files(t)
  const { code } = await createPairingCode(f.codes)
  // age the code past its TTL by rewriting the file
  const raw = JSON.parse(await (await import("node:fs/promises")).readFile(f.codes, "utf8"))
  raw[0].expiresAt = Date.now() - 1000
  await (await import("node:fs/promises")).writeFile(f.codes, JSON.stringify(raw))
  await assert.rejects(() => exchangePairingCode(code, "ios", undefined, f.codes, f.devices), /invalid or expired/)
})

test("revoked devices stop authorizing", async (t) => {
  const f = await files(t)
  const { code } = await createPairingCode(f.codes)
  const { deviceToken, deviceId } = await exchangePairingCode(code, "ios", undefined, f.codes, f.devices)
  assert.equal(await deviceTokenAuthorized(deviceToken, f.devices), true)
  assert.equal(await revokeDevice(deviceId, f.devices), true)
  assert.equal(await deviceTokenAuthorized(deviceToken, f.devices), false)
  assert.equal(await revokeDevice(deviceId, f.devices), false, "double revoke is a no-op false")
})
