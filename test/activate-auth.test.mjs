// Activation always requires auth (owner session, agent token, or mobile
// tasks:activate) - anonymous plain or isolated launches must be refused.
// The route pulls in Next-only imports, so the ordering invariant is pinned
// at source and the behavior is proven over HTTP by scripts/e2e.
// Run: node --experimental-strip-types --test test/activate-auth.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

test("activate route rejects anonymous callers before any runtime or repo work", async () => {
  const src = await readFile(new URL("../app/api/tasks/activate/route.ts", import.meta.url), "utf8")
  const authIdx = src.indexOf("Anonymous activation is never allowed")
  const repoIdx = src.indexOf('typeof repoPath === "string"')
  const runtimeIdx = src.indexOf("runtime.activate(")
  assert.ok(authIdx > -1, "auth gate exists")
  assert.ok(authIdx < repoIdx, "auth gate runs before the repoPath branch")
  assert.ok(authIdx < runtimeIdx, "auth gate runs before any runtime launch")
  // The isolated branch no longer carries its own (previously only) auth check:
  // the single gate above covers both plain and isolated activation.
  const isolatedSection = src.slice(repoIdx)
  assert.ok(!isolatedSection.includes("Sign in required for isolated runs"),
    "duplicate branch-local auth removed; one gate covers all activations")
  assert.ok(isolatedSection.includes('mobileTokenHas("tasks:activate")') || src.includes('mobileTokenHas("tasks:activate")'),
    "mobile capability check present")
})
