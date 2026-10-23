// Dinghy connect link builder. Run: node --test test/connector-url.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { DINGHY_DEFAULT_CONNECT_URL, buildDinghyConnectUrl, signConnectHint } from "../lib/connector-url.ts"

test("default URL points at the canonical www connect page with the pair code", () => {
  const url = new URL(buildDinghyConnectUrl({ code: "ABCD-2345", workspaceId: "ws_1" }))
  assert.equal(url.origin + url.pathname, DINGHY_DEFAULT_CONNECT_URL)
  assert.equal(url.searchParams.get("pair"), "ABCD-2345")
  // no shared secret configured: no hint, so Dinghy always shows its consent page
  assert.equal(url.searchParams.get("w"), null)
  assert.equal(url.searchParams.get("sig"), null)
})

test("a configured secret adds a signed workspace hint over the exact URL code", () => {
  const secret = "shared-webhook-secret"
  const url = new URL(buildDinghyConnectUrl({ code: "ABCD-2345", workspaceId: "ws_1", secret }))
  assert.equal(url.searchParams.get("w"), "ws_1")
  assert.equal(url.searchParams.get("sig"), signConnectHint(secret, "ABCD-2345", "ws_1"))
  assert.match(url.searchParams.get("sig"), /^[0-9a-f]{64}$/)
})

test("the signature binds code and workspace: swapping either fails verification", () => {
  const secret = "shared-webhook-secret"
  const sig = signConnectHint(secret, "ABCD-2345", "ws_1")
  assert.notEqual(sig, signConnectHint(secret, "WXYZ-9876", "ws_1"))
  assert.notEqual(sig, signConnectHint(secret, "ABCD-2345", "ws_evil"))
  assert.notEqual(sig, signConnectHint("other-secret", "ABCD-2345", "ws_1"))
})

test("an empty base override falls back to the default", () => {
  const url = buildDinghyConnectUrl({ code: "ABCD-2345", workspaceId: "ws_1", base: "  " })
  assert.ok(url.startsWith(DINGHY_DEFAULT_CONNECT_URL))
})

test("a trailing slash on the base is normalized", () => {
  const url = buildDinghyConnectUrl({ code: "ABCD-2345", workspaceId: "ws_1", base: "https://dinghy.test/connect/dock/" })
  assert.ok(url.startsWith("https://dinghy.test/connect/dock?"))
})
