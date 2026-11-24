import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDocFields,
  checkSupersession,
  countFlags,
  documentView,
  flagView,
  prepareFlag,
  proposalView,
  rowToDocument,
} from "../lib/knowledge-store.ts";
import { computeTrustTier, parseKnowledgeDocument } from "../lib/knowledge-schema.ts";
import { flagId, parseKnowledgeFlag } from "../lib/knowledge-flags.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");

function fm(overrides = {}) {
  return {
    type: "domain",
    title: "Revenue recognition",
    description: "When revenue counts.",
    resource: null,
    tags: ["finance"],
    status: "active",
    timestamp: null,
    stale_after: null,
    superseded_by: null,
    generated: null,
    verified: [],
    sources: [],
    extensions: {},
    ...overrides,
  };
}

function docRow(overrides = {}) {
  const built = buildDocFields({
    path: "domain/revenue.md",
    frontmatter: fm(),
    body: "# Revenue\n\nRecognize revenue on delivery.\n",
    now: NOW,
  });
  return {
    id: "doc-1",
    workspace_id: "ws-1",
    owner_id: "user-1",
    created_at: "2026-11-24T12:00:00Z",
    updated_at: "2026-11-24T12:00:00Z",
    ...built,
    ...overrides,
  };
}

test("buildDocFields materializes through the schema module", () => {
  const built = buildDocFields({
    path: "domain/revenue.md",
    frontmatter: fm({ stale_after: "2030-01-01T00:00:00Z" }),
    body: "# Revenue\n\nRecognize revenue on delivery.\n",
    now: NOW,
  });
  assert.equal(built.doc_id, "domain/revenue");
  assert.equal(built.doc_path, "domain/revenue.md");
  assert.equal(built.type, "domain");
  assert.equal(built.freshness, "fresh");
  assert.equal(built.trust_tier, "unverified");
  assert.match(built.content_hash, /^[0-9a-f]{64}$/);
});

test("buildDocFields derives the path from the docId and normalizes .md away", () => {
  const built = buildDocFields({ docId: "skill/deploy.md", frontmatter: fm({ type: "skill" }), body: "# Deploy\n" });
  assert.equal(built.doc_id, "skill/deploy");
  assert.equal(built.doc_path, "skill/deploy.md");
});

test("buildDocFields rejects an unusable identity", () => {
  assert.throws(() => buildDocFields({ frontmatter: fm(), body: "# x\n" }), /docId or path/);
});

test("documentView.body is portable OKF markdown that re-parses", () => {
  const view = documentView(docRow());
  assert.ok(view.body.startsWith("---\n"));
  assert.match(view.body, /type: domain/);
  const parsed = parseKnowledgeDocument(view.body, { path: "domain/revenue.md", now: NOW });
  assert.equal(parsed.contentHash, view.contentHash);
  assert.equal(view.docId, "domain/revenue");
  assert.deepEqual(view.tags, ["finance"]);
});

test("rowToDocument recomputes trust and freshness from the stored frontmatter", () => {
  const row = docRow({
    frontmatter: fm({
      generated: { by: "agent/scout", at: "2026-01-01T00:00:00Z", extensions: {} },
      verified: [{ by: "human:halsey", at: "2026-01-02T00:00:00Z", extensions: {} }],
    }),
  });
  assert.equal(computeTrustTier(row.frontmatter), "human-reviewed");
  assert.equal(rowToDocument(row, NOW).trustTier, "human-reviewed");
});

test("countFlags tallies each kind", () => {
  assert.deepEqual(
    countFlags([
      { kind: "missing", ref: "a", suggestedFix: null, evidence: null },
      { kind: "missing", ref: "b", suggestedFix: null, evidence: null },
      { kind: "wrong", ref: "c", suggestedFix: null, evidence: null },
    ]),
    { missing: 2, wrong: 1, stale: 0 },
  );
});

test("prepareFlag validates with the pure parser and yields the stable hash", () => {
  const good = prepareFlag({ kind: "stale", ref: "./domain/revenue.md", suggestedFix: "Refresh" });
  assert.equal(good.ok, true);
  if (!good.ok) return;
  assert.equal(good.flag.ref, "domain/revenue");
  assert.equal(good.hash, flagId(good.flag));

  assert.equal(prepareFlag({ kind: "bogus" }).ok, false);
  assert.equal(prepareFlag(null).ok, false);
});

test("flagView maps DB columns to the API shape", () => {
  const view = flagView({
    id: "flag-1",
    workspace_id: "ws-1",
    owner_id: "user-1",
    flag_hash: "hash",
    kind: "wrong",
    ref: "domain/revenue",
    suggested_fix: "fix",
    evidence: { quote: "old" },
    run_id: "run-9",
    created_at: "2026-11-24T12:00:00Z",
  });
  assert.deepEqual(view, {
    id: "flag-1",
    kind: "wrong",
    ref: "domain/revenue",
    suggestedFix: "fix",
    evidence: { quote: "old" },
    runId: "run-9",
    flagHash: "hash",
    createdAt: "2026-11-24T12:00:00Z",
  });
});

test("proposalView keeps the row id and exposes planner fields", () => {
  const view = proposalView({
    id: "row-id",
    workspace_id: "ws-1",
    owner_id: "user-1",
    proposal_key: "prop_abc",
    proposal: { id: "prop_abc", kind: "create", docPath: "skill/x.md", rationale: "why", priority: "high" },
    status: "pending",
    decision_by: null,
    decision_at: null,
    decision_reason: null,
    applied_doc_id: null,
    created_at: "2026-11-24T12:00:00Z",
    updated_at: "2026-11-24T12:00:00Z",
  });
  assert.equal(view.id, "row-id");
  assert.equal(view.plannerId, "prop_abc");
  assert.equal(view.kind, "create");
  assert.equal(view.status, "pending");
});

test("checkSupersession rejects missing targets and cycles, allows external URIs", () => {
  const docs = [
    { id: "domain/a", superseded_by: "domain/b" },
    { id: "domain/b", superseded_by: null },
  ];
  assert.deepEqual(checkSupersession(docs, { id: "domain/c", superseded_by: "domain/b" }), { ok: true });
  assert.equal(checkSupersession(docs, { id: "domain/c", superseded_by: "domain/missing" }).ok, false);

  const cyclic = [
    { id: "domain/a", superseded_by: "domain/b" },
    { id: "domain/b", superseded_by: "domain/a" },
  ];
  const cycle = checkSupersession(cyclic, { id: "domain/c", superseded_by: "domain/a" });
  assert.equal(cycle.ok, false);
  if (!cycle.ok) assert.equal(cycle.reason, "cycle");

  assert.deepEqual(checkSupersession(docs, { id: "domain/c", superseded_by: "https://example.com/x" }), { ok: true });
});
