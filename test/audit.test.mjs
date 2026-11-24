// WS5 audit: query parsing, fail-closed attribution mapping, summaries, and the joined query.
// Pure parts only (lib/audit.ts has no runtime imports); the listAudit fake stands in for Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_ACTOR_KINDS,
  auditActorKind,
  auditEntryFromRow,
  normalizeKind,
  normalizeLimit,
  parseAuditQuery,
  summarizeEvent,
} from "../lib/audit.ts";

const EVENT_ROW = {
  id: "ev-1",
  created_at: "2026-11-24T12:00:00.000Z",
  run_id: "run-1",
  kind: "approval_granted",
  data: { actionId: "act-9", type: "x402_spend", amountCents: 2500 },
  task_runs: { actor_kind: "connector", acting_as: "user-1", actor_ref: "conn-9" },
};

test("parseAuditQuery reads limit and kind", () => {
  assert.deepEqual(parseAuditQuery("http://localhost/api/audit?limit=5&kind=completed"), {
    limit: 5,
    kind: "completed",
  });
  assert.deepEqual(parseAuditQuery(new URL("http://localhost/api/audit")), { limit: 50, kind: null });
});

test("normalizeLimit defaults on missing/invalid and clamps oversized", () => {
  assert.equal(normalizeLimit(null), 50);
  assert.equal(normalizeLimit(undefined), 50);
  assert.equal(normalizeLimit(""), 50);
  assert.equal(normalizeLimit("abc"), 50);
  assert.equal(normalizeLimit("0"), 50);
  assert.equal(normalizeLimit("-3"), 50);
  assert.equal(normalizeLimit("1.5"), 50);
  assert.equal(normalizeLimit("250"), 200);
});

test("normalizeKind trims, drops blanks and oversized kinds", () => {
  assert.equal(normalizeKind(" completed "), "completed");
  assert.equal(normalizeKind(""), null);
  assert.equal(normalizeKind(null), null);
  assert.equal(normalizeKind("k".repeat(65)), null);
});

test("auditActorKind only accepts the three known kinds", () => {
  for (const kind of AUDIT_ACTOR_KINDS) assert.equal(auditActorKind(kind), kind);
  assert.equal(auditActorKind(undefined), "unknown");
  assert.equal(auditActorKind(null), "unknown");
  assert.equal(auditActorKind("owner "), "unknown");
  assert.equal(auditActorKind("superuser"), "unknown");
});

test("audit row mapping carries actor fields and summary", () => {
  const entry = auditEntryFromRow(EVENT_ROW);
  assert.deepEqual(entry, {
    id: "ev-1",
    at: "2026-11-24T12:00:00.000Z",
    runId: "run-1",
    actorKind: "connector",
    actingAs: "user-1",
    actorRef: "conn-9",
    kind: "approval_granted",
    summary: "approved: act-9 $25.00",
  });
});

test("fail-closed: missing attribution is unknown, never guessed to owner", () => {
  const legacy = auditEntryFromRow({
    id: "ev-2",
    created_at: "2026-11-24T12:00:00.000Z",
    run_id: "run-2",
    kind: "queued",
    data: {},
    task_runs: null,
  });
  assert.equal(legacy.actorKind, "unknown");
  assert.equal(legacy.actingAs, null);

  // actor_kind present but acting_as null stays null; owner_id is never substituted.
  const ownerNoHuman = auditEntryFromRow({
    ...EVENT_ROW,
    task_runs: { actor_kind: "owner", acting_as: null, actor_ref: null },
  });
  assert.equal(ownerNoHuman.actorKind, "owner");
  assert.equal(ownerNoHuman.actingAs, null);
  assert.equal(ownerNoHuman.actorRef, null);
});

test("summaries are deterministic and safe on malformed event data", () => {
  assert.equal(summarizeEvent("completed", {}), "run completed");
  assert.equal(summarizeEvent("failed", { error: "boom" }), "run failed: boom");
  assert.equal(summarizeEvent("cancelled", null), "run cancelled");
  assert.equal(summarizeEvent("action_failed", {}), "action failed: unknown error");
  assert.equal(summarizeEvent("mystery", { x: 1 }), "event mystery");
  assert.equal(summarizeEvent("", {}), "event");
});
