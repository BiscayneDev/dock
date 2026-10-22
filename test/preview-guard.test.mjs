// Approval preview rules. Run: node --test test/preview-guard.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  checkTargetUrl,
  capturePreviewForApproval,
  previewAccess,
  previewObjectPath,
  isOwnedPreviewPath,
  previewTargetFromRun,
  previewReasonLabel,
  PREVIEW_URL_TTL_SECONDS,
} from "../lib/preview-guard.ts"
import { previewFields, buildApprovalCards } from "../lib/approval-card.ts"

const OWNER = "11111111-2222-4333-8444-555555555555"
const OTHER = "99999999-2222-4333-8444-555555555555"
const RUN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

test("SSRF guard refuses every private, loopback and link-local range", () => {
  const blocked = [
    "http://localhost/x",
    "http://app.localhost/x",
    "http://127.0.0.1/",
    "http://127.255.1.9/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://service.internal/",
  ]
  for (const u of blocked) {
    const r = checkTargetUrl(u)
    assert.equal(r.ok, false, `should refuse ${u}`)
    assert.equal(r.reason, "private_address", u)
  }
})

test("SSRF guard refuses file: and other non-web schemes", () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/html,hi", "blob:https://x/1"]) {
    const r = checkTargetUrl(u)
    assert.equal(r.ok, false, u)
    assert.equal(r.reason, "scheme", u)
  }
})

test("SSRF guard allows public https and refuses credentials and junk", () => {
  assert.equal(checkTargetUrl("https://dock-harness.vercel.app/login").ok, true)
  assert.equal(checkTargetUrl("http://172.32.0.1/").ok, true, "172.32 is outside 172.16/12")
  assert.equal(checkTargetUrl("https://93.184.216.34/").ok, true)
  assert.equal(checkTargetUrl("https://user:pw@example.com/").reason, "invalid_url")
  assert.equal(checkTargetUrl("not a url").reason, "invalid_url")
  assert.equal(checkTargetUrl(42).reason, "invalid_url")
})

test("target comes from an explicit previewUrl, else an http(s) destination", () => {
  assert.equal(previewTargetFromRun({ previewUrl: "https://a.example/p" }, undefined), "https://a.example/p")
  assert.equal(previewTargetFromRun({}, "https://b.example/"), "https://b.example/")
  assert.equal(previewTargetFromRun({}, "wallet-123"), null)
  assert.equal(previewTargetFromRun({}, undefined), null)
})

test("capture failure still creates the approval with no screenshot and a reason", async () => {
  let stored = false
  const out = await capturePreviewForApproval(
    { ownerId: OWNER, runId: RUN, target: "https://example.com/" },
    {
      capture: async () => ({ ok: false, reason: "capture_failed" }),
      store: async () => ((stored = true), true),
      sign: async () => "https://x.supabase.co/signed",
      now: () => 1_700_000_000_000,
    },
  )
  assert.deepEqual(out, { ok: false, reason: "capture_failed" })
  assert.equal(stored, false, "nothing stored on failure")

  // The approval event the worker writes: no screenshot, reason recorded, card shows the reason.
  const fields = out.ok ? {} : { screenshotUrl: null, previewFailed: out.reason }
  const view = previewFields(RUN, fields, Date.now())
  assert.equal(view.screenshotUrl, null)
  assert.equal(previewReasonLabel(view.previewReason), "capture failed")
})

test("capture that hangs is cut off at the budget and never blocks the approval", async () => {
  const started = Date.now()
  const out = await capturePreviewForApproval(
    { ownerId: OWNER, runId: RUN, target: "https://example.com/" },
    {
      capture: () => new Promise(() => {}),
      store: async () => true,
      sign: async () => "https://x/",
      now: () => Date.now(),
    },
    50,
  )
  assert.deepEqual(out, { ok: false, reason: "capture_timeout" })
  assert.ok(Date.now() - started < 1000)
})

test("refused and missing targets never reach the browser", async () => {
  let called = false
  const deps = {
    capture: async () => ((called = true), { ok: false, reason: "capture_failed" }),
    store: async () => true,
    sign: async () => "https://x/",
    now: () => 1,
  }
  assert.deepEqual(await capturePreviewForApproval({ ownerId: OWNER, runId: RUN, target: "http://10.1.1.1/" }, deps), {
    ok: false,
    reason: "refused_target",
  })
  assert.deepEqual(await capturePreviewForApproval({ ownerId: OWNER, runId: RUN, target: null }, deps), {
    ok: false,
    reason: "no_target",
  })
  assert.equal(called, false)
})

test("successful capture stores an owner-scoped path and a signed https URL with a 24h TTL", async () => {
  const seen = {}
  const out = await capturePreviewForApproval(
    { ownerId: OWNER, runId: RUN, target: "https://example.com/" },
    {
      capture: async (url) => ((seen.host = url.hostname), { ok: true, png: new Uint8Array([137, 80, 78, 71]) }),
      store: async (path, png) => ((seen.path = path), (seen.bytes = png.length), true),
      sign: async (path, ttl) => ((seen.ttl = ttl), `https://hqnhbaxmxlmoudllgyuv.supabase.co/storage/v1/object/sign/approval-previews/${path}?token=t`),
      now: () => 1_700_000_000_000,
    },
  )
  assert.equal(out.ok, true)
  assert.equal(seen.ttl, PREVIEW_URL_TTL_SECONDS)
  assert.equal(seen.ttl, 86400)
  assert.equal(seen.path, `${OWNER}/${RUN}/1700000000000.png`)
  assert.equal(out.screenshotPath, seen.path)
  assert.equal(seen.bytes, 4)
  assert.equal(out.screenshotExpiresAt, new Date(1_700_000_000_000 + 86400_000).toISOString())
})

test("blob path is owner-scoped: <owner>/<run>/<stamp>.png, no traversal", () => {
  assert.equal(previewObjectPath(OWNER, RUN, 1700000000000), `${OWNER}/${RUN}/1700000000000.png`)
  assert.throws(() => previewObjectPath("../etc", RUN, 1), /uuid/)
  assert.throws(() => previewObjectPath(OWNER, `${RUN}/../x`, 1), /uuid/)
  assert.throws(() => previewObjectPath(OWNER, RUN, -1), /timestamp/)
  assert.equal(isOwnedPreviewPath(`${OWNER}/${RUN}/1.png`, OWNER, RUN), true)
  assert.equal(isOwnedPreviewPath(`${OTHER}/${RUN}/1.png`, OWNER, RUN), false, "another owner's folder")
  assert.equal(isOwnedPreviewPath(`${OWNER}/${OTHER}/1.png`, OWNER, RUN), false, "another run's folder")
  assert.equal(isOwnedPreviewPath(`${OWNER}/${RUN}/../1.png`, OWNER, RUN), false)
  assert.equal(isOwnedPreviewPath(`${OWNER}/${RUN}/1.svg`, OWNER, RUN), false)
})

test("preview route access: refuses non-owners, missing runs and foreign paths", () => {
  const run = { id: RUN, ownerId: OWNER }
  const path = `${OWNER}/${RUN}/1700000000000.png`
  assert.deepEqual(previewAccess(run, OWNER, path), { ok: true, path })
  assert.deepEqual(previewAccess(run, OTHER, path), { ok: false, reason: "forbidden" }, "non-owner refused")
  assert.deepEqual(previewAccess(run, null, path), { ok: false, reason: "not_found" }, "signed out")
  assert.deepEqual(previewAccess(null, OWNER, path), { ok: false, reason: "not_found" }, "RLS hid the run")
  assert.deepEqual(previewAccess(run, OWNER, undefined), { ok: false, reason: "no_preview" })
  assert.deepEqual(previewAccess(run, OWNER, `${OTHER}/${RUN}/1.png`), { ok: false, reason: "no_preview" })
})

test("expiry triggers regeneration: fresh stored URL is used, expired one falls back to the route", () => {
  const now = Date.parse("2026-10-22T12:00:00Z")
  const url = "https://hqnhbaxmxlmoudllgyuv.supabase.co/storage/v1/object/sign/approval-previews/p?token=t"
  const path = `${OWNER}/${RUN}/1.png`
  const fresh = previewFields(RUN, { screenshotUrl: url, screenshotPath: path, screenshotExpiresAt: new Date(now + 3600_000).toISOString() }, now)
  assert.equal(fresh.screenshotUrl, url)
  const expired = previewFields(RUN, { screenshotUrl: url, screenshotPath: path, screenshotExpiresAt: new Date(now - 1).toISOString() }, now)
  assert.equal(expired.screenshotUrl, `/api/approvals/${RUN}/preview`, "card asks the owner route for a fresh URL")
  const noExpiry = previewFields(RUN, { screenshotUrl: url, screenshotPath: path }, now)
  assert.equal(noExpiry.screenshotUrl, `/api/approvals/${RUN}/preview`, "no expiry recorded: regenerate")
  const bad = previewFields(RUN, { screenshotUrl: "javascript:alert(1)" }, now)
  assert.equal(bad.screenshotUrl, null, "non-https never rendered")
})

test("cards: stored URL swapped for the route after expiry, and reason surfaces", () => {
  const created = "2026-10-22T10:00:00Z"
  const now = Date.parse("2026-10-23T12:00:00Z")
  const run = { id: RUN, status: "awaiting_approval", conversationId: "c", projectId: null, model: null, budgetCents: 0, payload: {} }
  const ev = (data) => [{ runId: RUN, kind: "approval_requested", data: { actionId: "a1", ...data }, createdAt: created }]
  const [withShot] = buildApprovalCards(
    [run], ev({ screenshotUrl: "https://x.supabase.co/s?token=t", screenshotPath: `${OWNER}/${RUN}/1.png`, screenshotExpiresAt: "2026-10-23T10:00:00Z" }), "c", {}, () => true, now,
  )
  assert.equal(withShot.screenshotUrl, `/api/approvals/${RUN}/preview`)
  const [failed] = buildApprovalCards([run], ev({ screenshotUrl: null, previewFailed: "capture_timeout" }), "c", {}, () => true, now)
  assert.equal(failed.screenshotUrl, null)
  assert.equal(failed.previewReason, "capture_timeout")
  assert.equal(previewReasonLabel(failed.previewReason), "page took too long")
})
