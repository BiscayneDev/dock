import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FLAG_EVIDENCE,
  MAX_FLAG_FIX,
  MAX_FLAG_REF,
  KnowledgeFlagError,
  countDuplicateFlags,
  dedupeFlags,
  flagId,
  groupFlagsByRef,
  normalizeFlagRef,
  parseKnowledgeFlag,
  tryParseKnowledgeFlag,
} from "../lib/knowledge-flags.ts";

test("parseKnowledgeFlag accepts and normalizes a full payload", () => {
  const flag = parseKnowledgeFlag({
    kind: "MISSING",
    ref: "  /Skills/Deploy.md  ",
    suggestedFix: "  Run the deploy checklist.  ",
    evidence: { runId: "run_1", quote: "no deploy guidance found" },
  });
  assert.deepEqual(flag, {
    kind: "missing",
    ref: "Skills/Deploy",
    suggestedFix: "Run the deploy checklist.",
    evidence: { runId: "run_1", quote: "no deploy guidance found" },
  });
});

test("optional flag fields normalize to null", () => {
  assert.deepEqual(parseKnowledgeFlag({ kind: "wrong" }), {
    kind: "wrong",
    ref: null,
    suggestedFix: null,
    evidence: null,
  });
  assert.deepEqual(parseKnowledgeFlag({ kind: "stale", ref: "", suggestedFix: "   ", evidence: "" }), {
    kind: "stale",
    ref: null,
    suggestedFix: null,
    evidence: null,
  });
  assert.deepEqual(parseKnowledgeFlag({ kind: "missing", evidence: ["", "  "] }), {
    kind: "missing",
    ref: null,
    suggestedFix: null,
    evidence: null,
  });
});

test("normalizeFlagRef table", () => {
  const cases = [
    ["/metrics/revenue.md", "metrics/revenue"],
    ["./a//b/", "a/b"],
    ["a/b/", "a/b"],
    ["  spaced   out  ", "spaced out"],
    ["https://example.com/x.md", "https://example.com/x.md"],
    [null, null],
    ["", null],
    ["   ", null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeFlagRef(input), expected, String(input));
  }
});

test("invalid flag payloads fail closed with typed codes", () => {
  const cases = [
    ["not an object", "nope", "FLAG_NOT_OBJECT"],
    ["array", [{ kind: "missing" }], "FLAG_NOT_OBJECT"],
    ["kind missing", {}, "FLAG_KIND_MISSING"],
    ["kind invalid", { kind: "broken" }, "FLAG_KIND_INVALID"],
    ["kind wrong type", { kind: 42 }, "FLAG_KIND_INVALID"],
    ["ref wrong type", { kind: "missing", ref: 7 }, "FLAG_REF_INVALID"],
    ["ref empty after trim", { kind: "missing", ref: "/" }, "FLAG_REF_INVALID"],
    ["fix wrong type", { kind: "missing", suggestedFix: {} }, "FLAG_FIX_INVALID"],
    ["evidence array with number", { kind: "missing", evidence: ["ok", 3] }, "FLAG_EVIDENCE_INVALID"],
    ["evidence bigint", { kind: "missing", evidence: { n: 1n } }, "FLAG_EVIDENCE_INVALID"],
    ["ref too long", { kind: "missing", ref: "x".repeat(MAX_FLAG_REF + 1) }, "FLAG_REF_INVALID"],
    ["fix too long", { kind: "missing", suggestedFix: "x".repeat(MAX_FLAG_FIX + 1) }, "FLAG_FIX_INVALID"],
    [
      "evidence too large",
      { kind: "missing", evidence: "x".repeat(MAX_FLAG_EVIDENCE + 1) },
      "FLAG_EVIDENCE_INVALID",
    ],
  ];
  for (const [label, raw, code] of cases) {
    assert.throws(() => parseKnowledgeFlag(raw), (e) => e instanceof KnowledgeFlagError && e.code === code, label);
  }
});

test("unknown extra keys are tolerated (agents add trace metadata)", () => {
  const flag = parseKnowledgeFlag({ kind: "missing", ref: "a", traceId: "t1", runId: "r1" });
  assert.equal(flag.kind, "missing");
  assert.equal(flag.ref, "a");
});

test("flagId is stable, order-independent on evidence keys, and distinguishes content", () => {
  const base = parseKnowledgeFlag({ kind: "missing", ref: "skills/deploy", suggestedFix: "Do X." });
  const same = parseKnowledgeFlag({ kind: "missing", ref: "skills/deploy", suggestedFix: "Do X." });
  const reorderedEvidence = parseKnowledgeFlag({
    kind: "missing",
    ref: "a",
    evidence: { runId: "r1", quote: "q" },
  });
  const reorderedEvidence2 = parseKnowledgeFlag({
    kind: "missing",
    ref: "a",
    evidence: { quote: "q", runId: "r1" },
  });
  assert.equal(flagId(base), flagId(same));
  assert.match(flagId(base), /^flag_[0-9a-f]{64}$/);
  assert.equal(flagId(reorderedEvidence), flagId(reorderedEvidence2));
  assert.notEqual(
    flagId(parseKnowledgeFlag({ kind: "wrong", ref: "a" })),
    flagId(parseKnowledgeFlag({ kind: "stale", ref: "a" })),
  );
  assert.notEqual(
    flagId(parseKnowledgeFlag({ kind: "missing", ref: "a", evidence: "one" })),
    flagId(parseKnowledgeFlag({ kind: "missing", ref: "a", evidence: "two" })),
  );
});

test("dedupeFlags collapses identical flags preserving first-seen order", () => {
  const a = parseKnowledgeFlag({ kind: "missing", ref: "a" });
  const b = parseKnowledgeFlag({ kind: "wrong", ref: "b" });
  const aAgain = parseKnowledgeFlag({ kind: "missing", ref: "a" });
  const c = parseKnowledgeFlag({ kind: "missing", ref: "c", evidence: "different" });
  const unique = dedupeFlags([a, b, aAgain, c]);
  assert.deepEqual(unique, [a, b, c]);
  assert.equal(countDuplicateFlags([a, b, aAgain, c]), 1);
  assert.equal(countDuplicateFlags([]), 0);
});

test("tryParseKnowledgeFlag returns a result union instead of throwing", () => {
  const good = tryParseKnowledgeFlag({ kind: "stale", ref: "x" });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.flag.kind, "stale");
  const bad = tryParseKnowledgeFlag({ kind: "nope" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.code, "FLAG_KIND_INVALID");
});

test("groupFlagsByRef groups deterministically with null refs first", () => {
  const noRef = parseKnowledgeFlag({ kind: "stale" });
  const a1 = parseKnowledgeFlag({ kind: "missing", ref: "a" });
  const a2 = parseKnowledgeFlag({ kind: "wrong", ref: "a" });
  const b = parseKnowledgeFlag({ kind: "missing", ref: "b" });
  const groups = groupFlagsByRef([b, a2, noRef, a1]);
  assert.deepEqual(
    groups.map((g) => [g.ref, g.flags.length]),
    [
      ["", 1],
      ["a", 2],
      ["b", 1],
    ],
  );
});
