// Pure rule engine tests for lib/listener-rules.ts (node --test).
import test from "node:test";
import assert from "node:assert/strict";
import {
  CIRCUIT_BREAKER_ERRORS,
  CIRCUIT_BREAKER_WINDOW,
  DEFAULT_MAX_ENQUEUES_PER_MINUTE,
  REPLAY_WINDOW_SECONDS,
  decideListener,
  evaluateRule,
  isValidFilterPath,
  matchesFilter,
  normalizeFilterRules,
  rateLimit,
  readPath,
  stableStringify,
} from "../lib/listener-rules.ts";

const event = {
  action: "closed",
  pull_request: { state: "merged", additions: 120, labels: ["bug", "urgent"], author: null },
  repository: { full_name: "acme/api" },
  items: [{ id: 3 }, { id: 7 }],
};

function rules(match, list) {
  return normalizeFilterRules({ match, rules: list });
}

test("normalizeFilterRules accepts a well-formed filter and drops unknown keys", () => {
  const result = normalizeFilterRules({
    match: "any",
    extra: true,
    rules: [
      { path: "action", op: "eq", value: "closed", junk: 1 },
      { path: "pull_request.additions", op: "gt", value: 10 },
      { path: "pull_request.author", op: "exists" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rules.match, "any");
  assert.deepEqual(result.rules.rules[0], { path: "action", op: "eq", value: "closed" });
  assert.deepEqual(result.rules.rules[2], { path: "pull_request.author", op: "exists" });
});

test("normalizeFilterRules fails closed on invalid schemas", () => {
  const bad = [
    null,
    [],
    "x",
    { rules: "nope" },
    { match: "sometimes", rules: [] },
    { rules: [{ path: "", op: "eq", value: 1 }] },
    { rules: [{ path: "a..b", op: "eq", value: 1 }] },
    { rules: [{ path: "a b", op: "eq", value: 1 }] },
    { rules: [{ path: "action", op: "matches", value: "x" }] },
    { rules: [{ path: "action", op: "eq" }] },
    { rules: [{ path: "action", op: "eq", value: null }] },
    { rules: [{ path: "action", op: "eq", value: { a: 1 } }] },
    { rules: [{ path: "action", op: "eq", value: Number.NaN }] },
    { rules: Array.from({ length: 51 }, () => ({ path: "a", op: "exists" })) },
  ];
  for (const input of bad) {
    const result = normalizeFilterRules(input);
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(input)}`);
  }
  // Missing match defaults to all; missing rules defaults to empty (accept-all).
  assert.equal(normalizeFilterRules({ rules: [] }).ok, true);
  assert.equal(normalizeFilterRules({}).ok, true);
});

test("isValidFilterPath allows dotted paths and array indices", () => {
  assert.equal(isValidFilterPath("a.b.c"), true);
  assert.equal(isValidFilterPath("items.0.id"), true);
  assert.equal(isValidFilterPath("a.b!"), false);
  assert.equal(isValidFilterPath(""), false);
  assert.equal(isValidFilterPath("a..b"), false);
});

test("readPath traverses objects and arrays", () => {
  assert.equal(readPath(event, "action"), "closed");
  assert.equal(readPath(event, "pull_request.state"), "merged");
  assert.equal(readPath(event, "items.1.id"), 7);
  assert.equal(readPath(event, "items.9.id"), undefined);
  assert.equal(readPath(event, "missing.path"), undefined);
});

test("eq / neq", () => {
  assert.equal(evaluateRule({ path: "action", op: "eq", value: "closed" }, event), true);
  assert.equal(evaluateRule({ path: "action", op: "eq", value: "opened" }, event), false);
  assert.equal(evaluateRule({ path: "absent", op: "eq", value: "x" }, event), false);
  // Missing path satisfies neq (the field is not equal to the value).
  assert.equal(evaluateRule({ path: "absent", op: "neq", value: "x" }, event), true);
  assert.equal(evaluateRule({ path: "action", op: "neq", value: "opened" }, event), true);
});

test("contains over strings and arrays", () => {
  assert.equal(evaluateRule({ path: "repository.full_name", op: "contains", value: "acme" }, event), true);
  assert.equal(evaluateRule({ path: "repository.full_name", op: "contains", value: "nope" }, event), false);
  assert.equal(evaluateRule({ path: "pull_request.labels", op: "contains", value: "urgent" }, event), true);
  assert.equal(evaluateRule({ path: "pull_request.labels", op: "contains", value: "missing" }, event), false);
  assert.equal(evaluateRule({ path: "pull_request.additions", op: "contains", value: 1 }, event), false);
});

test("exists", () => {
  // `exists` means the path is present; a present null still counts as existing.
  assert.equal(evaluateRule({ path: "pull_request.author", op: "exists" }, event), true);
  assert.equal(evaluateRule({ path: "pull_request.state", op: "exists" }, event), true);
  assert.equal(evaluateRule({ path: "nope", op: "exists" }, event), false);
});

test("gt / lt numeric and string comparison", () => {
  assert.equal(evaluateRule({ path: "pull_request.additions", op: "gt", value: 100 }, event), true);
  assert.equal(evaluateRule({ path: "pull_request.additions", op: "lt", value: 100 }, event), false);
  assert.equal(evaluateRule({ path: "repository.full_name", op: "gt", value: "acme/a" }, event), true);
  assert.equal(evaluateRule({ path: "pull_request.author", op: "gt", value: 1 }, event), false);
});

test("match:any requires one hit, match:all requires every hit", () => {
  const any = rules("any", [
    { path: "action", op: "eq", value: "opened" },
    { path: "repository.full_name", op: "contains", value: "acme" },
  ]);
  const all = rules("all", [
    { path: "action", op: "eq", value: "closed" },
    { path: "pull_request.additions", op: "gt", value: 100 },
    { path: "repository.full_name", op: "contains", value: "zzz" },
  ]);
  assert.equal(any.ok && matchesFilter(any.rules, event), true);
  assert.equal(all.ok && matchesFilter(all.rules, event), false);
  assert.equal(matchesFilter({ match: "all", rules: [] }, event), true);
});

test("decideListener: enqueue, filter, invalid rules", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const ok = decideListener({
    filterRules: { match: "all", rules: [{ path: "action", op: "eq", value: "closed" }] },
    event,
    nowMs: now,
  });
  assert.equal(ok.decision, "enqueue");
  assert.equal(ok.reason, "ok");

  const filtered = decideListener({
    filterRules: { match: "all", rules: [{ path: "action", op: "eq", value: "opened" }] },
    event,
    nowMs: now,
  });
  assert.equal(filtered.decision, "filter");
  assert.equal(filtered.reason, "no_match");
  assert.match(filtered.detail, /failed: action eq/);

  const invalid = decideListener({
    filterRules: { rules: [{ path: "action", op: "bogus", value: 1 }] },
    event,
    nowMs: now,
  });
  assert.equal(invalid.decision, "filter");
  assert.equal(invalid.reason, "invalid_rules");
});

test("rateLimit: default 20/min, window eviction, retryAfterMs", () => {
  assert.equal(DEFAULT_MAX_ENQUEUES_PER_MINUTE, 20);
  const now = Date.parse("2026-11-24T12:01:00Z");
  const stamps = (n, startOffsetMs = 0) =>
    Array.from({ length: n }, (_, i) => new Date(now - startOffsetMs - i * 1000).toISOString());

  assert.equal(rateLimit([], now).allowed, true);
  assert.equal(rateLimit(stamps(19), now).allowed, true);
  const atLimit = rateLimit(stamps(20), now);
  assert.equal(atLimit.allowed, false);
  assert.equal(atLimit.count, 20);
  assert.ok(atLimit.retryAfterMs > 0 && atLimit.retryAfterMs <= 60_000);

  // Old entries outside the minute do not count.
  assert.equal(rateLimit(stamps(25, 120_000), now).allowed, true);

  const limited = decideListener({
    filterRules: { rules: [] },
    event,
    nowMs: now,
    recentEnqueues: stamps(20),
  });
  assert.equal(limited.decision, "filter");
  assert.equal(limited.reason, "rate_limited");

  const custom = rateLimit(stamps(3), now, 3);
  assert.equal(custom.allowed, false);
  assert.equal(REPLAY_WINDOW_SECONDS, 300);
  assert.equal(CIRCUIT_BREAKER_ERRORS, 10);
  assert.equal(CIRCUIT_BREAKER_WINDOW, 20);
});

test("stableStringify sorts keys so identical payloads hash identically", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(stableStringify([2, 1]), "[2,1]");
});
