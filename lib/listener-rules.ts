/**
 * Listener filter rules (WS4). Pure functions only: no imports at all, so node --test can load this
 * file directly. The DB wiring lives in lib/listeners.ts and dispatch lives in lib/listener-dispatch.ts.
 *
 * A listener's filter is `{ match: "any" | "all", rules: FilterRule[] }`, evaluated against the raw
 * webhook event JSON. This runs BEFORE any enqueue (and therefore before any model call): a cheap,
 * deterministic pre-filter that decides `enqueue` or `filter`.
 *
 * Ops: eq | neq | contains | exists | gt | lt. Paths are dotted (`pull_request.state`, `items.0.id`).
 * Empty rules accept everything (`enqueue`) — rate limiting is the guard for unfiltered listeners.
 */

export const LISTENER_OPS = ["eq", "neq", "contains", "exists", "gt", "lt"] as const;
export type ListenerOp = (typeof LISTENER_OPS)[number];

export const FILTER_MATCH_MODES = ["any", "all"] as const;
export type FilterMatchMode = (typeof FILTER_MATCH_MODES)[number];

export interface FilterRule {
  path: string;
  op: ListenerOp;
  value?: string | number | boolean;
}

export interface FilterRules {
  match: FilterMatchMode;
  rules: FilterRule[];
}

/** Default cap: max accepted enqueues per listener per rolling minute. */
export const DEFAULT_MAX_ENQUEUES_PER_MINUTE = 20;
/** Replay window for event-id dedupe, mirroring CONNECTOR_REPLAY_WINDOW_SECONDS (300s). */
export const REPLAY_WINDOW_SECONDS = 300;
/** Circuit breaker: pause after this many errored deliveries among the last CIRCUIT_BREAKER_WINDOW. */
export const CIRCUIT_BREAKER_ERRORS = 10;
export const CIRCUIT_BREAKER_WINDOW = 20;

export const MAX_RULES = 50;
export const MAX_PATH_LENGTH = 200;
export const MAX_VALUE_LENGTH = 500;

const PATH_SEGMENT = /^[A-Za-z0-9_\-]+$/;

export type NormalizeResult =
  | { ok: true; rules: FilterRules }
  | { ok: false; reason: string };

function isScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return value.length <= MAX_VALUE_LENGTH;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

/** Validates path syntax: dot-separated alphanumeric/underscore/dash segments, numeric indices allowed. */
export function isValidFilterPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0)) return false;
  return segments.every(
    (segment) => PATH_SEGMENT.test(segment) || /^[0-9]{1,9}$/.test(segment),
  );
}

function normalizeRule(raw: unknown, index: number): { ok: true; rule: FilterRule } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `rule ${index} must be an object` };
  }
  const record = raw as Record<string, unknown>;
  if (!isValidFilterPath(record.path)) {
    return { ok: false, reason: `rule ${index} has an invalid path` };
  }
  if (!(LISTENER_OPS as readonly string[]).includes(record.op as string)) {
    return { ok: false, reason: `rule ${index} has an invalid op` };
  }
  const op = record.op as ListenerOp;
  if (op === "exists") {
    return { ok: true, rule: { path: record.path as string, op } };
  }
  const value = record.value;
  if (value === undefined) {
    return { ok: false, reason: `rule ${index} (${op}) requires a value` };
  }
  if (!isScalar(value)) {
    return { ok: false, reason: `rule ${index} value must be a string, number or boolean` };
  }
  return { ok: true, rule: { path: record.path as string, op, value } };
}

/**
 * Validates and normalizes untrusted input into FilterRules. Unknown keys are dropped; the result
 * only ever contains path/op/value. Fails closed on anything malformed.
 */
export function normalizeFilterRules(input: unknown): NormalizeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "filterRules must be an object" };
  }
  const record = input as Record<string, unknown>;
  const match = record.match ?? "all";
  if (!(FILTER_MATCH_MODES as readonly string[]).includes(match as string)) {
    return { ok: false, reason: "filterRules.match must be 'any' or 'all'" };
  }
  const rawRules = record.rules ?? [];
  if (!Array.isArray(rawRules)) {
    return { ok: false, reason: "filterRules.rules must be an array" };
  }
  if (rawRules.length > MAX_RULES) {
    return { ok: false, reason: `filterRules.rules must have at most ${MAX_RULES} entries` };
  }
  const rules: FilterRule[] = [];
  for (let i = 0; i < rawRules.length; i += 1) {
    const normalized = normalizeRule(rawRules[i], i);
    if (!normalized.ok) return { ok: false, reason: normalized.reason };
    rules.push(normalized.rule);
  }
  return { ok: true, rules: { match: match as FilterMatchMode, rules } };
}

/** Reads a dotted path from an object/array tree. Returns undefined when any segment is missing. */
export function readPath(root: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    return (
      ak.length === bk.length &&
      ak.every((key) =>
        deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
      )
    );
  }
  return false;
}

/** Evaluates one rule against the event. Missing paths: eq/contains/gt/lt/exists false, neq true. */
export function evaluateRule(rule: FilterRule, event: unknown): boolean {
  const actual = readPath(event, rule.path);
  switch (rule.op) {
    case "eq":
      return actual !== undefined && deepEqual(actual, rule.value);
    case "neq":
      return actual === undefined || !deepEqual(actual, rule.value);
    case "contains": {
      if (actual === undefined) return false;
      if (typeof actual === "string" && typeof rule.value === "string") {
        return actual.includes(rule.value);
      }
      if (Array.isArray(actual)) return actual.some((item) => deepEqual(item, rule.value));
      return false;
    }
    case "exists":
      return actual !== undefined;
    case "gt":
    case "lt": {
      if (typeof actual === "number" && typeof rule.value === "number") {
        return rule.op === "gt" ? actual > rule.value : actual < rule.value;
      }
      if (typeof actual === "string" && typeof rule.value === "string") {
        return rule.op === "gt" ? actual > rule.value : actual < rule.value;
      }
      return false;
    }
    default:
      return false;
  }
}

export interface RuleEvaluation {
  rule: FilterRule;
  matched: boolean;
}

/** Per-rule results, for delivery detail ("why did this fire / not fire"). */
export function explainFilterRules(rules: FilterRules, event: unknown): RuleEvaluation[] {
  return rules.rules.map((rule) => ({ rule, matched: evaluateRule(rule, event) }));
}

/** True when the event satisfies the filter. No rules at all accepts everything. */
export function matchesFilter(rules: FilterRules, event: unknown): boolean {
  if (rules.rules.length === 0) return true;
  const evaluations = explainFilterRules(rules, event);
  return rules.match === "any"
    ? evaluations.some((evaluation) => evaluation.matched)
    : evaluations.every((evaluation) => evaluation.matched);
}

export interface RateLimitResult {
  allowed: boolean;
  /** Enqueues already accepted inside the window. */
  count: number;
  /** Ms until the oldest in-window enqueue leaves the window (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Rolling-window rate limit over ISO timestamps of previously accepted enqueues.
 * Pure: the caller supplies the timestamps and the clock.
 */
export function rateLimit(
  recentIsoTimes: readonly string[],
  nowMs: number,
  maxPerMinute: number = DEFAULT_MAX_ENQUEUES_PER_MINUTE,
  windowMs: number = 60_000,
): RateLimitResult {
  const limit = Number.isFinite(maxPerMinute) && maxPerMinute > 0
    ? Math.floor(maxPerMinute)
    : DEFAULT_MAX_ENQUEUES_PER_MINUTE;
  const inside: number[] = [];
  for (const iso of recentIsoTimes) {
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at)) continue;
    if (at >= nowMs - windowMs && at <= nowMs) inside.push(at);
  }
  const count = inside.length;
  if (count >= limit) {
    const oldest = inside.reduce((min, at) => (at < min ? at : min), inside[0]);
    return { allowed: false, count, retryAfterMs: Math.max(0, oldest + windowMs - nowMs) };
  }
  return { allowed: true, count, retryAfterMs: 0 };
}

/** Stable JSON serialization (sorted object keys) so identical payloads hash identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export type ListenerDecision = "enqueue" | "filter";

export interface DecideInput {
  /** Raw, unvalidated filterRules. Invalid input filters (fail closed). */
  filterRules: unknown;
  event: unknown;
  nowMs?: number;
  /** ISO timestamps of this listener's accepted enqueues, newest or oldest. */
  recentEnqueues?: readonly string[];
  maxPerMinute?: number;
}

export interface DecideOutcome {
  decision: ListenerDecision;
  reason: "ok" | "no_match" | "rate_limited" | "invalid_rules";
  detail: string;
  rules?: FilterRules;
}

/**
 * Cheap pre-enqueue decision: validate -> match -> rate limit. Never throws.
 */
export function decideListener(input: DecideInput): DecideOutcome {
  const normalized = normalizeFilterRules(input.filterRules);
  if (!normalized.ok) {
    return { decision: "filter", reason: "invalid_rules", detail: normalized.reason };
  }
  const rules = normalized.rules;
  const nowMs = input.nowMs ?? Date.now();

  if (!matchesFilter(rules, input.event)) {
    const failed = explainFilterRules(rules, input.event)
      .filter((evaluation) => !evaluation.matched)
      .map((evaluation) => `${evaluation.rule.path} ${evaluation.rule.op}`)
      .slice(0, 3)
      .join(", ");
    return {
      decision: "filter",
      reason: "no_match",
      detail: failed ? `no matching rules (failed: ${failed})` : "no matching rules",
      rules,
    };
  }

  const limit = rateLimit(input.recentEnqueues ?? [], nowMs, input.maxPerMinute);
  if (!limit.allowed) {
    return {
      decision: "filter",
      reason: "rate_limited",
      detail: `rate limit: ${limit.count} enqueues in the last minute`,
      rules,
    };
  }

  const count = rules.rules.length;
  return {
    decision: "enqueue",
    reason: "ok",
    detail: count === 0 ? "no filter rules" : `matched ${count} rule${count === 1 ? "" : "s"} (${rules.match})`,
    rules,
  };
}
