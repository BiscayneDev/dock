// Scoped mobile token: capability surface, timing-safe compare, fail closed.
// Run: node --experimental-strip-types --test test/mobile-auth.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.DOCK_MOBILE_TOKEN = "test-mobile-token-123"
const { mobileEnvTokenAuthorized, mobileTokenHas, MOBILE_CAPABILITIES } = await import("../lib/mobile-auth.ts")


function req(headers = {}) {
  return new Request("https://dock.local/api/x", { headers })
}

test("mobile token: valid bearer passes, wrong/missing/unset fails", async () => {
  assert.equal(mobileEnvTokenAuthorized(req({ authorization: "Bearer test-mobile-token-123" })), true)
  assert.equal(mobileEnvTokenAuthorized(req({ "x-dock-mobile-token": "test-mobile-token-123" })), true)
  assert.equal(mobileEnvTokenAuthorized(req({ authorization: "Bearer wrong" })), false)
  assert.equal(mobileEnvTokenAuthorized(req({ authorization: "Bearer test-mobile-token-1234" })), false)
  assert.equal(mobileEnvTokenAuthorized(req()), false)
})

test("capability surface is explicit and closed", () => {
  for (const cap of ["runs:read", "runs:create", "runs:decide"]) {
    assert.equal(mobileTokenHas(cap), true, cap)
  }
  // no notify/activity/agent-done/worker-style capabilities
  assert.equal(mobileTokenHas("notify:send"), false)
  assert.equal(mobileTokenHas("repos:write"), false)
  assert.equal(MOBILE_CAPABILITIES.includes("repos:write"), false)
})
