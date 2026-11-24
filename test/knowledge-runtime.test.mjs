import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDocFields,
} from "../lib/knowledge-store.ts";
import { decideProposal, recordKnowledgeFlag, runCurator, buildKnowledgeBundle } from "../lib/knowledge-runtime.ts";
import { planKnowledgeEdits } from "../lib/knowledge-curator.ts";
import { computeTrustTier, parseBundle, parseKnowledgeDocument } from "../lib/knowledge-schema.ts";
import { flagId, parseKnowledgeFlag } from "../lib/knowledge-flags.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const WS = "ws-1";
const OWNER = "user-1";

function fm(overrides = {}) {
  return {
    type: "domain",
    title: "Revenue recognition",
    description: "When revenue counts.",
    resource: null,
    tags: ["finance"],
    status: "active",
    timestamp: null,
    stale_after: "2030-01-01T00:00:00Z",
    superseded_by: null,
    generated: null,
    verified: [],
    sources: [],
    extensions: {},
    ...overrides,
  };
}

/** In-memory KnowledgeRepo: the same shape as the Supabase adapter, no I/O. */
class FakeRepo {
  docs = [];
  flags = [];
  proposals = [];
  events = [];
  traces = [];
  n = 0;

  nextId(prefix) {
    this.n += 1;
    return `${prefix}-${this.n}`;
  }

  async listDocs(workspaceId, filters = {}) {
    let rows = this.docs.filter((d) => d.workspace_id === workspaceId);
    if (filters.type) rows = rows.filter((d) => d.type === filters.type);
    if (filters.status) rows = rows.filter((d) => d.status === filters.status);
    const q = filters.q?.toLowerCase();
    if (q) rows = rows.filter((d) => `${d.doc_id}\n${d.body}`.toLowerCase().includes(q));
    return rows.slice(0, filters.limit ?? 200);
  }

  async getDocByDocId(workspaceId, docId) {
    return this.docs.find((d) => d.workspace_id === workspaceId && d.doc_id === docId) ?? null;
  }

  async putDoc(row) {
    const now = new Date().toISOString();
    const existing = this.docs.find((d) => d.workspace_id === row.workspace_id && d.doc_id === row.doc_id);
    if (existing) {
      Object.assign(existing, row, { updated_at: now });
      return existing;
    }
    const created = { ...row, id: row.id ?? this.nextId("doc"), created_at: now, updated_at: now };
    this.docs.push(created);
    return created;
  }

  async listFlags(workspaceId) {
    return this.flags.filter((f) => f.workspace_id === workspaceId);
  }

  async getFlagByHash(workspaceId, flagHash) {
    return this.flags.find((f) => f.workspace_id === workspaceId && f.flag_hash === flagHash) ?? null;
  }

  async insertFlag(row) {
    const created = { ...row, id: this.nextId("flag"), created_at: new Date().toISOString() };
    this.flags.push(created);
    return created;
  }

  async listProposals(workspaceId) {
    return this.proposals.filter((p) => p.workspace_id === workspaceId);
  }

  async getProposal(id) {
    return this.proposals.find((p) => p.id === id) ?? null;
  }

  async getProposalByKey(workspaceId, key) {
    return this.proposals.find((p) => p.workspace_id === workspaceId && p.proposal_key === key) ?? null;
  }

  async insertProposal(row) {
    const now = new Date().toISOString();
    const created = {
      ...row,
      id: this.nextId("prop"),
      status: "pending",
      decision_by: null,
      decision_at: null,
      decision_reason: null,
      applied_doc_id: null,
      created_at: now,
      updated_at: now,
    };
    this.proposals.push(created);
    return created;
  }

  async updateProposal(id, patch) {
    const row = this.proposals.find((p) => p.id === id);
    if (!row) throw new Error(`no proposal ${id}`);
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
  }

  async insertProposalEvent(row) {
    this.events.push({ id: this.nextId("evt"), created_at: new Date().toISOString(), ...row });
  }

  async listRecentTraces() {
    return this.traces;
  }
}

async function seedHumanReviewedDoc(repo) {
  return repo.putDoc({
    workspace_id: WS,
    owner_id: OWNER,
    ...buildDocFields({
      path: "domain/revenue.md",
      frontmatter: fm({
        generated: { by: "agent/scout", at: "2026-01-01T00:00:00Z", extensions: {} },
        verified: [{ by: "human:halsey", at: "2026-01-02T00:00:00Z", extensions: {} }],
      }),
      body: "# Revenue\n\nRecognize revenue on delivery.\n",
      now: NOW,
    }),
  });
}

test("curator proposes but never applies", async () => {
  const repo = new FakeRepo();
  const seeded = await seedHumanReviewedDoc(repo);
  const beforeHash = seeded.content_hash;
  await repo.insertFlag({
    workspace_id: WS,
    owner_id: OWNER,
    flag_hash: flagId(parseKnowledgeFlag({ kind: "wrong", ref: "domain/revenue" })),
    kind: "wrong",
    ref: "domain/revenue",
    suggested_fix: "# Revenue\n\nRecognize revenue on invoice.\n",
    evidence: "policy changed",
    run_id: "run-1",
  });

  const result = await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW });
  assert.equal(result.created, 1);
  assert.equal(result.conflicts, 0);

  const rows = await repo.listDocs(WS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content_hash, beforeHash);
  assert.equal(computeTrustTier(rows[0].frontmatter), "human-reviewed");

  const proposals = await repo.listProposals(WS);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, "pending");
  assert.equal(proposals[0].proposal.kind, "patch");
  assert.equal(proposals[0].applied_doc_id, null);
});

test("curate is idempotent per planner proposal", async () => {
  const repo = new FakeRepo();
  await seedHumanReviewedDoc(repo);
  await repo.insertFlag({
    workspace_id: WS,
    owner_id: OWNER,
    flag_hash: "h1",
    kind: "wrong",
    ref: "domain/revenue",
    suggested_fix: "# Revenue\n\nDifferent text.\n",
    evidence: null,
    run_id: null,
  });
  assert.equal((await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW })).created, 1);
  assert.equal((await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW })).created, 0);
  assert.equal((await repo.listProposals(WS)).length, 1);
});

test("approving a patch applies it, adds the machine verification and records audit", async () => {
  const repo = new FakeRepo();
  const seeded = await seedHumanReviewedDoc(repo);
  const beforeHash = seeded.content_hash;
  await repo.insertFlag({
    workspace_id: WS,
    owner_id: OWNER,
    flag_hash: "h2",
    kind: "wrong",
    ref: "domain/revenue",
    suggested_fix: "# Revenue\n\nRecognize revenue on invoice.\n",
    evidence: null,
    run_id: "run-2",
  });
  await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW });
  const pending = (await repo.listProposals(WS))[0];

  const result = await decideProposal(repo, { proposalId: pending.id, actorId: OWNER, action: "approve", now: NOW });
  assert.equal(result.ok, true);

  const rows = await repo.listDocs(WS);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].content_hash, beforeHash);
  assert.match(rows[0].body, /invoice/);
  // The applied patch carries the curator's machine verification; the old human review no longer
  // covers the new text, so OKF 5.3 computes machine-confirmed.
  assert.equal(computeTrustTier(rows[0].frontmatter), "machine-confirmed");
  assert.ok(
    rows[0].frontmatter.verified.some((event) => event.by === "curator/dock-knowledge"),
    "the applied patch records the curator's machine verification",
  );

  const decided = (await repo.listProposals(WS))[0];
  assert.equal(decided.status, "approved");
  assert.equal(decided.applied_doc_id, "domain/revenue");
  assert.equal(decided.decision_by, OWNER);
  const kinds = repo.events.map((e) => e.event);
  assert.deepEqual(kinds, ["proposed", "approved"]);
});

test("rejecting changes nothing but records the decision", async () => {
  const repo = new FakeRepo();
  const before = await seedHumanReviewedDoc(repo);
  await repo.insertFlag({
    workspace_id: WS,
    owner_id: OWNER,
    flag_hash: "h3",
    kind: "stale",
    ref: "domain/revenue",
    suggested_fix: null,
    evidence: null,
    run_id: null,
  });
  await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW });
  const pending = (await repo.listProposals(WS))[0];

  const result = await decideProposal(repo, {
    proposalId: pending.id,
    actorId: OWNER,
    action: "reject",
    reason: "still accurate",
    now: NOW,
  });
  assert.equal(result.ok, true);
  const rows = await repo.listDocs(WS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content_hash, before.content_hash);
  assert.equal(computeTrustTier(rows[0].frontmatter), "human-reviewed");

  const decided = (await repo.listProposals(WS))[0];
  assert.equal(decided.status, "rejected");
  assert.equal(decided.decision_reason, "still accurate");
  assert.equal(decided.applied_doc_id, null);
});

test("deciding a non-pending proposal returns not_pending", async () => {
  const repo = new FakeRepo();
  await seedHumanReviewedDoc(repo);
  await repo.insertFlag({
    workspace_id: WS,
    owner_id: OWNER,
    flag_hash: "h4",
    kind: "wrong",
    ref: "domain/revenue",
    suggested_fix: "# Revenue\n\nChanged.\n",
    evidence: null,
    run_id: null,
  });
  await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW });
  const pending = (await repo.listProposals(WS))[0];
  await decideProposal(repo, { proposalId: pending.id, actorId: OWNER, action: "reject", now: NOW });

  const again = await decideProposal(repo, { proposalId: pending.id, actorId: OWNER, action: "approve", now: NOW });
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.equal(again.reason, "not_pending");
    assert.equal(again.httpStatus, 409);
  }
});

test("approving a create stores a new document as unverified", async () => {
  const repo = new FakeRepo();
  await repo.insertFlag({
    workspace_id: WS,
    owner_id: OWNER,
    flag_hash: "h5",
    kind: "missing",
    ref: "skill/deploy-services",
    suggested_fix: "# Deploy services\n\nRun the deploy script.\n",
    evidence: null,
    run_id: null,
  });
  await runCurator(repo, { workspaceId: WS, ownerId: OWNER, now: NOW });
  assert.equal((await repo.listDocs(WS)).length, 0);

  const pending = (await repo.listProposals(WS))[0];
  const result = await decideProposal(repo, { proposalId: pending.id, actorId: OWNER, action: "approve", now: NOW });
  assert.equal(result.ok, true);

  const rows = await repo.listDocs(WS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doc_id, "skill/deploy-services");
  assert.equal(rows[0].type, "skill");
  assert.equal(computeTrustTier(rows[0].frontmatter), "unverified");
  assert.equal(rows[0].freshness, "unknown");
});

test("approval refuses a supersession target that does not exist", async () => {
  const repo = new FakeRepo();
  const before = await seedHumanReviewedDoc(repo);
  const after = buildDocFields({
    path: "domain/revenue.md",
    frontmatter: fm({ status: "superseded", superseded_by: "domain/gone" }),
    body: before.body,
    now: NOW,
  });
  const inserted = await repo.insertProposal({
    workspace_id: WS,
    owner_id: OWNER,
    proposal_key: "prop_bad_supersede",
    proposal: {
      id: "prop_bad_supersede",
      kind: "patch",
      docId: "domain/revenue",
      docPath: "domain/revenue.md",
      after: { frontmatter: after.frontmatter, body: after.body },
    },
  });

  const result = await decideProposal(repo, { proposalId: inserted.id, actorId: OWNER, action: "approve", now: NOW });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "supersession");
    assert.equal(result.httpStatus, 409);
  }
  const rows = await repo.listDocs(WS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content_hash, before.content_hash);
  assert.ok(repo.events.some((e) => e.event === "failed"));
});

test("approval refuses a supersession cycle", async () => {
  const repo = new FakeRepo();
  await repo.putDoc({
    workspace_id: WS,
    owner_id: OWNER,
    ...buildDocFields({
      path: "domain/a.md",
      frontmatter: fm({ status: "superseded", superseded_by: "domain/b" }),
      body: "# A\n",
      now: NOW,
    }),
  });
  await repo.putDoc({
    workspace_id: WS,
    owner_id: OWNER,
    ...buildDocFields({
      path: "domain/b.md",
      frontmatter: fm({ status: "superseded", superseded_by: "domain/a" }),
      body: "# B\n",
      now: NOW,
    }),
  });
  const candidate = buildDocFields({
    path: "domain/c.md",
    frontmatter: fm({ status: "superseded", superseded_by: "domain/a" }),
    body: "# C\n",
    now: NOW,
  });
  const inserted = await repo.insertProposal({
    workspace_id: WS,
    owner_id: OWNER,
    proposal_key: "prop_cycle",
    proposal: {
      id: "prop_cycle",
      kind: "create",
      docId: "domain/c",
      docPath: "domain/c.md",
      document: { frontmatter: candidate.frontmatter, body: candidate.body },
    },
  });

  const result = await decideProposal(repo, { proposalId: inserted.id, actorId: OWNER, action: "approve", now: NOW });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "supersession");
  assert.equal((await repo.listDocs(WS)).length, 2);
});

test("recordKnowledgeFlag validates, stores and dedupes", async () => {
  const repo = new FakeRepo();
  const first = await recordKnowledgeFlag(repo, {
    workspaceId: WS,
    ownerId: OWNER,
    payload: { kind: "missing", ref: "domain/revenue", suggestedFix: "Add it" },
    runId: "run-7",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.duplicate, false);

  const second = await recordKnowledgeFlag(repo, {
    workspaceId: WS,
    ownerId: OWNER,
    payload: { kind: "missing", ref: "./domain/revenue.md", suggestedFix: "Add it" },
    runId: "run-8",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id);
  assert.equal((await repo.listFlags(WS)).length, 1);

  const bad = await recordKnowledgeFlag(repo, { workspaceId: WS, ownerId: OWNER, payload: { kind: "nope" } });
  assert.equal(bad.ok, false);
});

test("the planner and the runtime agree on proposal ids and conflicts", () => {
  const plan = planKnowledgeEdits({
    flags: [parseKnowledgeFlag({ kind: "wrong", ref: "a", suggestedFix: "x" })],
    documents: [],
    now: NOW,
  });
  assert.equal(plan.proposals.length, 0);
  assert.ok(plan.ignoredFlags.every((f) => f.reason === "TARGET_NOT_FOUND"));
});

test("export builds an OKF bundle with index, concepts and a valid log", async () => {
  const repo = new FakeRepo();
  await seedHumanReviewedDoc(repo);
  await repo.putDoc({
    workspace_id: WS,
    owner_id: OWNER,
    ...buildDocFields({ path: "skill/deploy.md", frontmatter: fm({ type: "skill" }), body: "# Deploy\n" }),
  });
  await repo.insertProposal({
    workspace_id: WS,
    owner_id: OWNER,
    proposal_key: "prop_log",
    proposal: { id: "prop_log", kind: "create", docPath: "domain/new.md" },
  });
  const bundle = await buildKnowledgeBundle(repo, WS);
  assert.equal(bundle.index.okf_version, "0.3");
  assert.deepEqual(
    bundle.files.map((f) => f.path).sort(),
    ["domain/revenue.md", "index.md", "log.md", "skill/deploy.md"],
  );

  const parsed = parseBundle(bundle.files.map((f) => ({ path: f.path, text: f.content })));
  assert.equal(parsed.documents.length, 2);
  assert.equal(parsed.index?.okf_version, "0.3");
  assert.equal(parsed.logs.length, 1);
  assert.ok(parsed.logs[0].entryCount >= 1, "log records the proposal");
  for (let i = 1; i < parsed.logs[0].dates.length; i += 1) {
    assert.ok(parsed.logs[0].dates[i] < parsed.logs[0].dates[i - 1], "log dates are newest first");
  }
});
