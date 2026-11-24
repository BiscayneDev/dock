import test from "node:test";
import assert from "node:assert/strict";
import {
  CURATOR_ACTOR,
  DEFAULT_MAX_PROPOSALS,
  computeDemotion,
  detectConflicts,
  inferKnowledgeType,
  planKnowledgeEdits,
} from "../lib/knowledge-curator.ts";
import { parseKnowledgeDocument } from "../lib/knowledge-schema.ts";
import { flagId, parseKnowledgeFlag } from "../lib/knowledge-flags.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");

function md(front, body) {
  return `---\n${front}\n---\n${body}`;
}

function doc(front, body, path) {
  return parseKnowledgeDocument(md(front, body), { path, now: NOW });
}

const HUMAN_REVIEWED = doc(
  [
    "type: domain",
    "description: Revenue recognition policy.",
    'generated: { by: "agent/scout", at: "2026-01-01T00:00:00Z" }',
    'verified: { by: "human:halsey", at: "2026-01-02T00:00:00Z" }',
    'stale_after: "2030-01-01T00:00:00Z"',
  ].join("\n"),
  "# Policy\n\nRecognize revenue on delivery.\n",
  "domain/revenue.md",
);

const MACHINE_CONFIRMED = doc(
  [
    "type: data_access",
    "resource: bigquery:projects/acme/tables/orders",
    "description: How to query the orders table.",
    'generated: { by: "agent/scout", at: "2026-01-01T00:00:00Z" }',
    'verified: [{ by: "process:finance-nightly", at: "2026-01-03T00:00:00Z" }]',
  ].join("\n"),
  "SELECT * FROM orders;",
  "data/access/orders.md",
);

const UNVERIFIED_SKILL = doc("type: skill", "# Deploy\n\nRun the checklist.", "skills/deploy.md");

const SUPERSEDED = doc(
  [
    "type: domain",
    "description: Old policy.",
    "status: superseded",
    "superseded_by: /domain/revenue.md",
  ].join("\n"),
  "Superseded body.",
  "domain/old-policy.md",
);

test("inferKnowledgeType uses the ref path first, then evidence wording", () => {
  const cases = [
    ["skills/deploy-hermes", null, "skill"],
    ["guides/how-to-deploy", null, "domain"],
    ["data/access/orders", null, "data_access"],
    ["sources/bigquery", null, "data_access"],
    ["domain/refund-policy", null, "domain"],
    [null, "how to procedure steps runbook", "skill"],
    [null, "query the endpoint column schema", "data_access"],
    [null, "a plain fact", "domain"],
    ["anything", "team policy", "domain"],
  ];
  for (const [ref, evidence, expected] of cases) {
    assert.equal(inferKnowledgeType(ref, evidence), expected, `${ref} / ${evidence}`);
  }
});

test("missing flag produces an unverified create proposal requiring approval", () => {
  const plan = planKnowledgeEdits({
    flags: [
      parseKnowledgeFlag({
        kind: "missing",
        ref: "skills/deploy-hermes",
        suggestedFix: "# Deploy\n\n1. Run tests.",
      }),
    ],
    documents: [],
    now: NOW,
  });
  assert.equal(plan.applied, false);
  assert.equal(plan.proposals.length, 1);
  const proposal = plan.proposals[0];
  assert.equal(proposal.kind, "create");
  assert.equal(proposal.flagKind, "missing");
  assert.equal(proposal.docId, "skills/deploy-hermes");
  assert.equal(proposal.document.type, "skill");
  assert.equal(proposal.document.trustTier, "unverified");
  assert.equal(proposal.approval, "required");
  assert.equal(proposal.priority, "normal");
  assert.ok(proposal.evidenceRefs.some((ref) => ref.startsWith("flag:")));
  assert.equal(plan.decisions.length, 1);
  assert.equal(plan.decisions[0].action, "approve_or_reject");
  assert.equal(plan.decisions[0].beforeTrust, null);
  assert.equal(plan.decisions[0].afterTrust, "unverified");
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.ignoredFlags, []);
  assert.equal(plan.stats.proposals, 1);
});

test("data_access creates are high priority; inferred from the ref segment", () => {
  const plan = planKnowledgeEdits({
    flags: [
      parseKnowledgeFlag({ kind: "missing", ref: "data/access/orders", suggestedFix: "Query orders." }),
    ],
    documents: [],
    now: NOW,
  });
  const proposal = plan.proposals[0];
  assert.equal(proposal.document.type, "data_access");
  assert.equal(proposal.priority, "high");
  assert.equal(proposal.document.frontmatter.resource, "data/access/orders");
});

test("wrong flag on a human-reviewed doc demotes it to machine-confirmed", () => {
  const flag = parseKnowledgeFlag({
    kind: "wrong",
    ref: "/domain/revenue.md",
    suggestedFix: "# Policy\n\nRecognize revenue on invoice.",
  });
  const plan = planKnowledgeEdits({ flags: [flag], documents: [HUMAN_REVIEWED], now: NOW });
  assert.equal(plan.proposals.length, 1);
  const proposal = plan.proposals[0];
  assert.equal(proposal.kind, "patch");
  assert.equal(proposal.flagKind, "wrong");
  assert.equal(proposal.before.id, "domain/revenue");
  assert.equal(proposal.after.body, "# Policy\n\nRecognize revenue on invoice.");
  assert.equal(proposal.section, "Policy");
  assert.ok(proposal.changedFields.includes("body"));
  assert.ok(proposal.changedFields.includes("generated"));
  assert.equal(proposal.demotion.from, "human-reviewed");
  assert.equal(proposal.demotion.to, "machine-confirmed");
  assert.equal(proposal.demotion.reason, "edited-after-review");
  assert.equal(proposal.demotion.reviewRequired, true);
  assert.equal(proposal.after.trustTier, "machine-confirmed");
  assert.equal(proposal.priority, "high");
  assert.equal(proposal.approval, "required");
  assert.equal(plan.decisions[0].demotion, true);
  assert.equal(plan.decisions[0].beforeTrust, "human-reviewed");
  assert.equal(plan.decisions[0].afterTrust, "machine-confirmed");
  assert.equal(computeDemotion(HUMAN_REVIEWED, proposal.after).to, "machine-confirmed");
  // The curator's own verification is current, so OKF 5.3 computes machine-confirmed.
  const machineEvents = proposal.after.frontmatter.verified.filter((event) => event.by === CURATOR_ACTOR);
  assert.equal(machineEvents.length, 1);
  assert.equal(proposal.after.frontmatter.generated.by, CURATOR_ACTOR);
});

test("wrong flag on a machine-confirmed doc stays machine-confirmed with no demotion", () => {
  const plan = planKnowledgeEdits({
    flags: [parseKnowledgeFlag({ kind: "wrong", ref: "data/access/orders", suggestedFix: "SELECT order_id FROM orders;" })],
    documents: [MACHINE_CONFIRMED],
    now: NOW,
  });
  const proposal = plan.proposals[0];
  assert.equal(proposal.demotion, null);
  assert.equal(proposal.after.trustTier, "machine-confirmed");
  assert.equal(proposal.priority, "high"); // data_access
  assert.equal(plan.decisions[0].demotion, false);
});

test("wrong flag identical to the current body is a no-op and is ignored", () => {
  const plan = planKnowledgeEdits({
    flags: [parseKnowledgeFlag({ kind: "wrong", ref: "domain/revenue", suggestedFix: HUMAN_REVIEWED.body })],
    documents: [HUMAN_REVIEWED],
    now: NOW,
  });
  assert.equal(plan.proposals.length, 0);
  assert.deepEqual(plan.ignoredFlags.map((f) => f.reason), ["NO_OP"]);
});

test("stale flag marks the doc stale without touching content or trust", () => {
  const plan = planKnowledgeEdits({
    flags: [parseKnowledgeFlag({ kind: "stale", ref: "domain/revenue" })],
    documents: [HUMAN_REVIEWED],
    now: NOW,
  });
  const proposal = plan.proposals[0];
  assert.equal(proposal.kind, "patch");
  assert.equal(proposal.flagKind, "stale");
  assert.equal(proposal.before.body, proposal.after.body);
  assert.equal(proposal.after.frontmatter.status, "stale");
  assert.equal(proposal.after.trustTier, "human-reviewed");
  assert.equal(proposal.demotion, null);
  assert.equal(proposal.priority, "low");
  assert.ok(proposal.changedFields.includes("status"));
  assert.equal(plan.decisions[0].priority, "low");
});

test("non-actionable flags are ignored with typed reasons", () => {
  const cases = [
    [parseKnowledgeFlag({ kind: "missing" }), [], "REF_REQUIRED"],
    [parseKnowledgeFlag({ kind: "missing", ref: "https://example.com/x" }), [], "EXTERNAL_REF"],
    [parseKnowledgeFlag({ kind: "missing", ref: "skills/new" }), [], "SUGGESTED_FIX_REQUIRED"],
    [parseKnowledgeFlag({ kind: "missing", ref: "skills/deploy", suggestedFix: "x" }), [UNVERIFIED_SKILL], "ALREADY_EXISTS"],
    [parseKnowledgeFlag({ kind: "wrong" }), [HUMAN_REVIEWED], "REF_REQUIRED"],
    [parseKnowledgeFlag({ kind: "wrong", ref: "domain/nope" }), [HUMAN_REVIEWED], "TARGET_NOT_FOUND"],
    [
      parseKnowledgeFlag({ kind: "wrong", ref: "domain/old-policy", suggestedFix: "new text" }),
      [SUPERSEDED],
      "DOC_SUPERSEDED",
    ],
    [parseKnowledgeFlag({ kind: "stale" }), [HUMAN_REVIEWED], "REF_REQUIRED"],
    [parseKnowledgeFlag({ kind: "stale", ref: "domain/nope" }), [HUMAN_REVIEWED], "TARGET_NOT_FOUND"],
    [
      parseKnowledgeFlag({ kind: "stale", ref: "domain/revenue" }),
      [doc("type: domain\ndescription: d\nstatus: stale", "Body.", "domain/revenue.md")],
      "ALREADY_STALE",
    ],
  ];
  for (const [flag, documents, reason] of cases) {
    const plan = planKnowledgeEdits({ flags: [flag], documents, now: NOW });
    assert.equal(plan.proposals.length, 0, reason);
    assert.deepEqual(plan.ignoredFlags.map((f) => f.reason), [reason], reason);
    assert.equal(plan.ignoredFlags[0].flagId, flagId(flag));
    assert.equal(plan.ignoredFlags[0].kind, flag.kind);
    assert.equal(plan.ignoredFlags[0].ref, flag.ref);
  }
});

test("detectConflicts reports same_section when proposals share a section, same_doc otherwise", () => {
  const fake = (id, kind, section) => ({ id, docId: "doc", kind, section });
  const sameSection = detectConflicts([fake("p1", "patch", "Policy"), fake("p2", "patch", "Policy")]);
  assert.equal(sameSection.length, 1);
  assert.equal(sameSection[0].type, "same_section");
  assert.deepEqual(sameSection[0].proposalIds, ["p1", "p2"]);

  const differentSections = detectConflicts([fake("p1", "patch", "A"), fake("p2", "patch", "B")]);
  assert.equal(differentSections.length, 1);
  assert.equal(differentSections[0].type, "same_doc");
  assert.equal(differentSections[0].section, null);

  const createAndPatch = detectConflicts([fake("p1", "create", null), fake("p2", "patch", "A")]);
  assert.equal(createAndPatch.length, 1);
  assert.equal(createAndPatch[0].type, "same_doc");

  assert.deepEqual(detectConflicts([fake("p1", "wrong", "A")]), []);
});

test("plan surfaces conflicts and blocks both decisions", () => {
  const flags = [
    parseKnowledgeFlag({ kind: "wrong", ref: "domain/revenue", suggestedFix: "# Policy\n\nFirst fix." }),
    parseKnowledgeFlag({ kind: "wrong", ref: "domain/revenue", suggestedFix: "# Policy\n\nSecond fix." }),
  ];
  const plan = planKnowledgeEdits({ flags, documents: [HUMAN_REVIEWED], now: NOW });
  assert.equal(plan.proposals.length, 2);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].type, "same_section");
  for (const proposal of plan.proposals) {
    assert.deepEqual(proposal.conflicts, plan.proposals.filter((p) => p.id !== proposal.id).map((p) => p.id));
  }
  for (const decision of plan.decisions) {
    assert.equal(decision.blockedBy.length, 1);
    assert.notEqual(decision.blockedBy[0], decision.proposalId);
  }
});

test("traces corroborate flags and become evidence references", () => {
  const traces = [
    { id: "t1", ref: "skills/deploy-hermes", error: "no deploy guidance" },
    { runId: "r9", message: "could not find skills/deploy-hermes" },
    { id: "t3", ref: "unrelated", error: "something else" },
  ];
  const plan = planKnowledgeEdits({
    flags: [parseKnowledgeFlag({ kind: "missing", ref: "skills/deploy-hermes", suggestedFix: "Do it." })],
    traces,
    documents: [],
    now: NOW,
  });
  const proposal = plan.proposals[0];
  assert.equal(proposal.supportCount, 2);
  assert.ok(proposal.evidenceRefs.includes("trace:t1"));
  assert.ok(proposal.evidenceRefs.includes("run:r9"));
  assert.ok(!proposal.evidenceRefs.includes("trace:t3"));
  assert.match(proposal.rationale, /corroborated by 2 run traces/);
});

test("identical flags dedupe into one proposal and plans are deterministic", () => {
  const flag = parseKnowledgeFlag({ kind: "missing", ref: "skills/deploy-hermes", suggestedFix: "Do it." });
  const input = { flags: [flag, flag], traces: [{ id: "t1", ref: "skills/deploy-hermes" }], documents: [], now: NOW };
  const first = planKnowledgeEdits(input);
  const second = planKnowledgeEdits(input);
  assert.equal(first.proposals.length, 1);
  assert.equal(first.stats.flags, 1);
  assert.deepEqual(first, second);
  assert.equal(DEFAULT_MAX_PROPOSALS, 50);
});

test("the planner never mutates its inputs", () => {
  const flag = parseKnowledgeFlag({ kind: "wrong", ref: "domain/revenue", suggestedFix: "# Policy\n\nChanged." });
  const snapshot = JSON.stringify({ flag, documents: [HUMAN_REVIEWED] });
  planKnowledgeEdits({ flags: [flag], documents: [HUMAN_REVIEWED], now: NOW });
  assert.equal(JSON.stringify({ flag, documents: [HUMAN_REVIEWED] }), snapshot);
});

test("maxProposals caps proposals and ignores the rest deterministically", () => {
  const flags = [
    parseKnowledgeFlag({ kind: "missing", ref: "skills/a", suggestedFix: "A." }),
    parseKnowledgeFlag({ kind: "missing", ref: "skills/b", suggestedFix: "B." }),
  ];
  const plan = planKnowledgeEdits({ flags, documents: [], now: NOW, maxProposals: 1 });
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].docId, "skills/a");
  assert.deepEqual(plan.ignoredFlags.map((f) => f.reason), ["PROPOSAL_LIMIT"]);
});
