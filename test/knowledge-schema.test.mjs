import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_TYPES,
  KNOWLEDGE_STATUSES,
  TRUST_TIERS,
  KnowledgeSchemaError,
  canonicalSerialize,
  computeFreshness,
  computeTrustTier,
  demoteAfterEdit,
  findSupersessionCycle,
  normalizeKnowledgePath,
  parseBundle,
  parseKnowledgeDocument,
  parseOkfTimestamp,
  rankTrustTier,
  serializeDocument,
  trustTierChange,
  verificationCurrency,
} from "../lib/knowledge-schema.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");

function docMd(front, body) {
  return `---\n${front}\n---\n${body}`;
}

const SKILL_FRONT = [
  "type: skill",
  "title: Deploy Hermes",
  "description: Build and ship a Hermes change.",
  "tags: [deploy, ops]",
  "status: active",
  'generated: { by: "agent/builder", at: "2026-11-01T09:00:00Z" }',
  "verified:",
  '  - by: "human:halsey"',
  '    at: "2026-11-02T09:00:00Z"',
  'stale_after: "2027-01-01T00:00:00Z"',
  "sources:",
  "  - id: runbook",
  "    resource: https://wiki.acme/runbook",
  "    title: Deploy runbook",
  '    author: "team:ops"',
  "    usage_count: 12",
  '    last_modified: "2026-10-01"',
  "x-acme-owner: platform",
].join("\n");

const SKILL_BODY = "# Steps\n\n1. Ship it.\n";

test("parseKnowledgeDocument: valid skill with full provenance", () => {
  const doc = parseKnowledgeDocument(docMd(SKILL_FRONT, SKILL_BODY), { path: "skills/deploy.md", now: NOW });
  assert.equal(doc.id, "skills/deploy");
  assert.equal(doc.path, "skills/deploy.md");
  assert.equal(doc.type, "skill");
  assert.deepEqual(doc.frontmatter.tags, ["deploy", "ops"]);
  assert.equal(doc.frontmatter.status, "active");
  assert.equal(doc.frontmatter.generated.by, "agent/builder");
  assert.equal(doc.frontmatter.verified.length, 1);
  assert.equal(doc.frontmatter.verified[0].by, "human:halsey");
  assert.equal(doc.trustTier, "human-reviewed");
  assert.equal(doc.freshness, "fresh");
  assert.equal(doc.frontmatter.sources[0].usage_count, 12);
  assert.equal(doc.frontmatter.extensions["x-acme-owner"], "platform");
  assert.match(doc.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(doc.evaluatedAt, NOW);
});

test("frontmatter failures fail closed with typed codes", () => {
  const cases = [
    ["missing", "# just markdown", "FRONTMATTER_MISSING"],
    ["unterminated", "---\ntype: skill\n", "FRONTMATTER_UNTERMINATED"],
    ["not a mapping", "---\nthis is not yaml\n---\nbody", "YAML_INVALID"],
    ["duplicate key", "---\ntype: skill\ntype: domain\n---\nbody", "DUPLICATE_KEY"],
    ["bad flow map", '---\ntype: skill\ngenerated: { by: "a/b"\n---\nbody', "YAML_INVALID"],
  ];
  for (const [label, text, code] of cases) {
    assert.throws(
      () => parseKnowledgeDocument(text, { path: "x.md" }),
      (err) => err instanceof KnowledgeSchemaError && err.code === code,
      label,
    );
  }
});

test("type is required and restricted to the Dock profile", () => {
  const missing = (fn) => {
    try {
      fn();
      return null;
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(missing(() => parseKnowledgeDocument(docMd("", "body"), { path: "x.md" })), "TYPE_MISSING");
  assert.equal(missing(() => parseKnowledgeDocument(docMd("type: ''", "body"), { path: "x.md" })), "TYPE_MISSING");
  assert.equal(missing(() => parseKnowledgeDocument(docMd("type: policy", "body"), { path: "x.md" })), "TYPE_INVALID");
  assert.equal(missing(() => parseKnowledgeDocument(docMd("type: 7", "body"), { path: "x.md" })), "TYPE_INVALID");
  for (const type of KNOWLEDGE_TYPES) {
    const extra = type === "skill" ? "" : type === "domain" ? "description: x" : "resource: https://x";
    const doc = parseKnowledgeDocument(docMd(`type: ${type}\n${extra}`, "body"), { path: "x.md", now: NOW });
    assert.equal(doc.type, type);
  }
});

test("status vocabulary and superseded_by coherence", () => {
  for (const status of KNOWLEDGE_STATUSES) {
    const doc = parseKnowledgeDocument(docMd(`type: skill\nstatus: ${status}`, "body"), { path: "x.md", now: NOW });
    assert.equal(doc.frontmatter.status, status);
  }
  assert.throws(
    () => parseKnowledgeDocument(docMd("type: skill\nstatus: bogus", "body"), { path: "x.md" }),
    (e) => e.code === "STATUS_INVALID",
  );
  assert.throws(
    () =>
      parseKnowledgeDocument(docMd("type: skill\nstatus: active\nsuperseded_by: /other.md", "body"), { path: "x.md" }),
    (e) => e.code === "SUPERSEDED_BY_WITHOUT_STATUS",
  );
});

test("required fields per knowledge type", () => {
  const cases = [
    ["skill", "type: skill", "", "body"],
    ["domain", "type: domain", "A fact.", "description"],
    ["data_access", "type: data_access", "Query it.", "resource"],
  ];
  for (const [type, front, body, path] of cases) {
    assert.throws(
      () => parseKnowledgeDocument(docMd(front, body), { path: "x.md" }),
      (e) => e.code === "FIELD_INVALID" && e.path === path,
      type,
    );
  }
  const domain = parseKnowledgeDocument(docMd("type: domain\ndescription: Revenue policy.", "Body."), { path: "x.md", now: NOW });
  assert.equal(domain.type, "domain");
  const access = parseKnowledgeDocument(
    docMd("type: data_access\nresource: bigquery:projects/acme/tables/orders", "Query it."),
    { path: "x.md", now: NOW },
  );
  assert.equal(access.type, "data_access");
});

test("parseOkfTimestamp accepts RFC 3339 date-times with offsets and bare dates", () => {
  assert.equal(parseOkfTimestamp("2026-06-30"), Date.UTC(2026, 5, 30));
  assert.equal(parseOkfTimestamp("2026-06-30T14:00:00Z"), Date.UTC(2026, 5, 30, 14));
  assert.equal(parseOkfTimestamp("2026-06-30T14:00:00.250Z"), Date.UTC(2026, 5, 30, 14, 0, 0, 250));
  assert.equal(parseOkfTimestamp("2026-06-30T14:00:00+05:30"), Date.UTC(2026, 5, 30, 8, 30));
  assert.equal(parseOkfTimestamp("2026-06-30T14:00:00"), null);
  assert.equal(parseOkfTimestamp("2026-13-40"), null);
  assert.equal(parseOkfTimestamp("tomorrow"), null);
  assert.equal(parseOkfTimestamp(""), null);
});

test("stale_after parsing and freshness comparison", () => {
  assert.throws(
    () => parseKnowledgeDocument(docMd('type: skill\nstale_after: "next tuesday"', "body"), { path: "x.md" }),
    (e) => e.code === "DATE_INVALID",
  );
  const dateOnly = parseKnowledgeDocument(docMd('type: skill\nstale_after: "2027-01-01"', "body"), { path: "x.md", now: NOW });
  assert.equal(dateOnly.freshness, "fresh");
  assert.equal(computeFreshness({ stale_after: null }, NOW), "unknown");
  assert.equal(computeFreshness({ stale_after: "2026-11-24T12:00:00Z" }, NOW), "stale");
  assert.equal(computeFreshness({ stale_after: "2026-11-24T12:00:01Z" }, NOW), "fresh");
  assert.equal(computeFreshness({ stale_after: "not-a-date" }, NOW), "malformed");
});

test("trust tiers follow OKF 5.3: only current verifications count", () => {
  const base = { generated: { by: "agent/builder", at: "2026-01-01T00:00:00Z" } };
  const cases = [
    ["no events", {}, "unverified"],
    ["machine current", { ...base, verified: [{ by: "process:ci", at: "2026-01-02T00:00:00Z" }] }, "machine-confirmed"],
    ["human current", { ...base, verified: [{ by: "human:halsey", at: "2026-01-02T00:00:00Z" }] }, "human-reviewed"],
    ["team is not human", { ...base, verified: [{ by: "team:finance", at: "2026-01-02T00:00:00Z" }] }, "machine-confirmed"],
    ["review predates edit", { ...base, verified: [{ by: "human:halsey", at: "2025-12-01T00:00:00Z" }] }, "unverified"],
    [
      "legacy timestamp used when generated absent",
      { timestamp: "2026-01-01T00:00:00Z", verified: [{ by: "human:halsey", at: "2026-01-02T00:00:00Z" }] },
      "human-reviewed",
    ],
    ["generated without at leaves all events current", { verified: [{ by: "human:halsey", at: "2020-01-01T00:00:00Z" }] }, "human-reviewed"],
  ];
  for (const [label, input, expected] of cases) {
    assert.equal(computeTrustTier(input), expected, label);
  }

  const currency = verificationCurrency({
    generated: base.generated,
    verified: [
      { by: "human:halsey", at: "2026-01-02T00:00:00Z" },
      { by: "process:ci", at: "2025-12-01T00:00:00Z" },
    ],
  });
  assert.equal(currency.baseline, Date.UTC(2026, 0, 1));
  assert.deepEqual(currency.current.map((e) => e.by), ["human:halsey"]);
  assert.deepEqual(currency.earlier.map((e) => e.by), ["process:ci"]);
});

test("demotion: an edit after human review is machine-confirmed until re-review", () => {
  const before = {
    generated: { by: "agent/builder", at: "2026-01-01T00:00:00Z" },
    verified: [{ by: "human:halsey", at: "2026-01-02T00:00:00Z" }],
  };
  const after = {
    generated: { by: "curator/dock-knowledge", at: "2026-02-01T00:00:00Z" },
    verified: [
      ...before.verified,
      { by: "curator/dock-knowledge", at: "2026-02-01T00:00:00Z" },
    ],
  };
  const change = trustTierChange(before, after);
  assert.deepEqual(
    { before: change.before, after: change.after, changed: change.changed, demoted: change.demoted },
    { before: "human-reviewed", after: "machine-confirmed", changed: true, demoted: true },
  );
  assert.equal(demoteAfterEdit("human-reviewed", after), "machine-confirmed");
  assert.equal(demoteAfterEdit("machine-confirmed", after), "machine-confirmed");
  // A newer human event restores the higher tier rather than being clamped down.
  const reReviewed = {
    generated: after.generated,
    verified: [...after.verified, { by: "human:halsey", at: "2026-03-01T00:00:00Z" }],
  };
  assert.equal(demoteAfterEdit("human-reviewed", reReviewed), "human-reviewed");
  assert.ok(rankTrustTier("human-reviewed") > rankTrustTier("machine-confirmed"));
  assert.deepEqual([...TRUST_TIERS], ["unverified", "machine-confirmed", "human-reviewed"]);
});

test("canonical serialization is order-independent and whitespace-stable", () => {
  const a = parseKnowledgeDocument(docMd(SKILL_FRONT, SKILL_BODY), { path: "skills/deploy.md", now: NOW });
  const reordered = [
    "x-acme-owner: platform",
    "status: active",
    "type: skill",
    'generated: { by: "agent/builder", at: "2026-11-01T09:00:00Z" }',
    'stale_after: "2027-01-01T00:00:00Z"',
    "verified:",
    '  - by: "human:halsey"',
    '    at: "2026-11-02T09:00:00Z"',
    "sources:",
    "  - id: runbook",
    "    resource: https://wiki.acme/runbook",
    "    title: Deploy runbook",
    '    author: "team:ops"',
    "    usage_count: 12",
    '    last_modified: "2026-10-01"',
    "tags: [deploy, ops]",
    "title: Deploy Hermes",
    "description: Build and ship a Hermes change.",
  ].join("\n");
  const b = parseKnowledgeDocument(docMd(reordered, `${SKILL_BODY}\n\n`), { path: "skills/deploy.md", now: NOW });
  assert.equal(canonicalSerialize(a), canonicalSerialize(b));
  assert.equal(a.contentHash, b.contentHash);

  const c = parseKnowledgeDocument(
    docMd(SKILL_FRONT.replace("Build and ship a Hermes change.", "Changed description."), SKILL_BODY),
    { path: "skills/deploy.md", now: NOW },
  );
  assert.notEqual(a.contentHash, c.contentHash);
});

test("serializeDocument round-trips through the parser", () => {
  const doc = parseKnowledgeDocument(docMd(SKILL_FRONT, SKILL_BODY), { path: "skills/deploy.md", now: NOW });
  const roundTripped = parseKnowledgeDocument(serializeDocument(doc), { path: doc.path, now: NOW });
  assert.deepEqual(roundTripped.frontmatter, doc.frontmatter);
  assert.equal(roundTripped.body, doc.body);
  assert.equal(canonicalSerialize(roundTripped), canonicalSerialize(doc));
});

test("normalizeKnowledgePath handles root-relative, dotted, duplicated slashes, and URIs", () => {
  const cases = [
    ["/metrics/gross-margin.md", "metrics/gross-margin"],
    ["./a//b/", "a/b"],
    ["a/b/", "a/b"],
    ["Skills/Deploy.MD", "Skills/Deploy"],
    ["https://example.com/x.md", "https://example.com/x.md"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeKnowledgePath(input), expected, input);
  }
});

test("findSupersessionCycle detects direct, indirect, and self cycles", () => {
  const direct = [
    { id: "a", superseded_by: "b" },
    { id: "b", superseded_by: "a" },
  ];
  const cycle = findSupersessionCycle(direct);
  assert.ok(cycle !== null);
  assert.deepEqual([...cycle].sort(), ["a", "a", "b"]);

  const self = findSupersessionCycle([{ id: "a", superseded_by: "a" }]);
  assert.ok(self !== null);
  assert.deepEqual(self, ["a", "a"]);

  assert.equal(findSupersessionCycle([{ id: "a", superseded_by: "b" }, { id: "b", superseded_by: null }]), null);
  assert.equal(findSupersessionCycle([{ id: "a", superseded_by: "missing" }]), null);
});

test("parseBundle reads index.md, log.md, concepts, and skips non-concepts", () => {
  const domain = [
    "type: domain",
    "title: Revenue policy",
    "description: Recognized revenue rules.",
    "status: active",
    'generated: { by: "agent/scout", at: "2026-11-01T00:00:00Z" }',
  ].join("\n");
  const files = [
    { path: "index.md", text: docMd('okf_version: "0.3"\ntitle: Acme knowledge', "# Index\n") },
    {
      path: "log.md",
      text: "# Update log\n\n## 2026-11-20\n* **Creation**: Revenue policy.\n\n## 2026-11-01\n* **Initialization**: Seed.\n",
    },
    { path: "domain/revenue.md", text: docMd(domain, "Revenue is recognized on delivery.") },
    { path: "skills/deploy.md", text: docMd(SKILL_FRONT, SKILL_BODY) },
    { path: "README.md", text: "# Not a concept\n" },
    { path: "assets/notes.txt", text: "asset" },
    { path: ".hidden/skip.md", text: docMd("type: skill", "skip me") },
    { path: "sub/index.md", text: "# Subdirectory listing\n" },
  ];
  const bundle = parseBundle(files, { now: NOW });
  assert.equal(bundle.index.okf_version, "0.3");
  assert.equal(bundle.index.title, "Acme knowledge");
  assert.deepEqual(bundle.logs.map((log) => log.dates), [["2026-11-20", "2026-11-01"]]);
  assert.equal(bundle.logs[0].entryCount, 2);
  assert.deepEqual(bundle.documents.map((doc) => doc.id), ["domain/revenue", "skills/deploy"]);
  assert.equal(bundle.byId["domain/revenue"].frontmatter.description, "Recognized revenue rules.");
});

test("bundle validation failures are typed", () => {
  const skill = docMd("type: skill", "body");
  const cases = [
    [
      "log frontmatter",
      [{ path: "log.md", text: docMd("type: skill", "body") }],
      "LOG_FRONTMATTER",
    ],
    [
      "log bad heading",
      [{ path: "log.md", text: "# Log\n\n## May 1\n* entry\n" }],
      "LOG_HEADING_INVALID",
    ],
    [
      "log order",
      [{ path: "log.md", text: "# Log\n\n## 2026-11-01\n* old\n\n## 2026-11-20\n* new\n" }],
      "LOG_ORDER_INVALID",
    ],
    [
      "index outside root",
      [{ path: "sub/index.md", text: docMd('title: "nope"', "# hi") }],
      "INDEX_FRONTMATTER_OUTSIDE_ROOT",
    ],
    [
      "case-insensitive id collision",
      [
        { path: "domain/Revenue.md", text: docMd("type: domain\ndescription: A", "A") },
        { path: "domain/revenue.md", text: docMd("type: domain\ndescription: B", "B") },
      ],
      "CONCEPT_ID_COLLISION",
    ],
    [
      "escape path",
      [{ path: "../outside.md", text: skill }],
      "BUNDLE_PATH_INVALID",
    ],
  ];
  for (const [label, files, code] of cases) {
    assert.throws(() => parseBundle(files, { now: NOW }), (e) => e.code === code, label);
  }
});

test("bundle supersession links resolve and reject missing targets or cycles", () => {
  const deprecated = (id, target) =>
    docMd(`type: domain\ndescription: ${id}\nstatus: superseded\nsuperseded_by: ${target}`, `Body ${id}`);
  assert.throws(
    () =>
      parseBundle([
        { path: "a.md", text: deprecated("a", "/missing.md") },
      ], { now: NOW }),
    (e) => e.code === "SUPERSEDED_TARGET_MISSING",
  );
  assert.throws(
    () =>
      parseBundle([
        { path: "a.md", text: deprecated("a", "/b.md") },
        { path: "b.md", text: deprecated("b", "a.md") },
      ], { now: NOW }),
    (e) => e.code === "SUPERSEDED_CYCLE",
  );
  const external = parseKnowledgeDocument(
    docMd("type: domain\ndescription: x\nstatus: superseded\nsuperseded_by: https://example.com/new.md", "Body"),
    { path: "a.md", now: NOW },
  );
  assert.equal(external.frontmatter.superseded_by, "https://example.com/new.md");
  const chain = parseBundle([
    { path: "a.md", text: deprecated("a", "/b.md") },
    { path: "b.md", text: docMd("type: domain\ndescription: b", "Body b") },
  ], { now: NOW });
  assert.deepEqual(chain.documents.map((doc) => doc.id), ["a", "b"]);
});
