// Scoped mobile token: capability surface, timing-safe compare, fail closed.
// Run: node --experimental-strip-types --test test/mobile-auth.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.DOCK_MOBILE_TOKEN = "test-mobile-token-123"
const { mobileTokenAuthorized, mobileTokenHas, MOBILE_CAPABILITIES } = await import("../lib/mobile-auth.ts")
const { isValidExpoPushToken, registerPushToken, listPushTokens, sendExpoPush } = await import("../lib/expo-push.ts")

function req(headers = {}) {
  return new Request("https://dock.local/api/x", { headers })
}

test("mobile token: valid bearer passes, wrong/missing/unset fails", () => {
  assert.equal(mobileTokenAuthorized(req({ authorization: "Bearer test-mobile-token-123" })), true)
  assert.equal(mobileTokenAuthorized(req({ "x-dock-mobile-token": "test-mobile-token-123" })), true)
  assert.equal(mobileTokenAuthorized(req({ authorization: "Bearer wrong" })), false)
  assert.equal(mobileTokenAuthorized(req({ authorization: "Bearer test-mobile-token-1234" })), false)
  assert.equal(mobileTokenAuthorized(req()), false)
})

test("capability surface is explicit and closed", () => {
  for (const cap of ["tasks:read", "tasks:activate", "repos:read", "worktree:read", "runs:read", "runs:decide", "push:register"]) {
    assert.equal(mobileTokenHas(cap), true, cap)
  }
  // no notify/activity/agent-done/worker-style capabilities
  assert.equal(mobileTokenHas("notify:send"), false)
  assert.equal(mobileTokenHas("repos:write"), false)
  assert.equal(MOBILE_CAPABILITIES.includes("repos:write"), false)
})

test("expo push token validation and registration", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-push-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "push-tokens.json")

  assert.equal(isValidExpoPushToken("ExponentPushToken[abc-DEF_123]"), true)
  assert.equal(isValidExpoPushToken("not-a-token"), false)
  assert.equal(isValidExpoPushToken(""), false)

  await registerPushToken("ExponentPushToken[device-one]", "ios", file)
  await registerPushToken("ExponentPushToken[device-one]", "ios", file) // idempotent
  await registerPushToken("ExponentPushToken[device-two]", "ios", file)
  assert.equal((await listPushTokens(file)).length, 2)
  await assert.rejects(() => registerPushToken("bogus", "ios", file), /not an Expo push token/)
})

test("sendExpoPush prunes dead devices and reports delivered count", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-push-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "push-tokens.json")
  await registerPushToken("ExponentPushToken[alive]", "ios", file)
  await registerPushToken("ExponentPushToken[dead]", "ios", file)

  const fakeFetch = async () => new Response(JSON.stringify({
    data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }],
  }), { status: 200 })
  const delivered = await sendExpoPush("Dock · builder", "Done: thing", {}, file, fakeFetch)
  assert.equal(delivered, 1)
  const remaining = await listPushTokens(file)
  assert.deepEqual(remaining.map((r) => r.token), ["ExponentPushToken[alive]"])
})

test("sendExpoPush never throws when the service is unreachable", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-push-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "push-tokens.json")
  await registerPushToken("ExponentPushToken[alive]", "ios", file)
  const delivered = await sendExpoPush("t", "b", {}, file, async () => { throw new Error("network down") })
  assert.equal(delivered, 0)
})
