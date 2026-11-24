// Knowledge flags: the payload a run emits when it finds missing, wrong, or stale knowledge.
//
// Pure parsing/normalization only. A flag never mutates anything; it is an observation with an
// optional suggested fix and evidence. Flags are deduplicated by a stable id so the same finding
// reported by several runs collapses into one curator input.
import { createHash } from "crypto";

export type KnowledgeFlagKind = "missing" | "wrong" | "stale";

export const KNOWLEDGE_FLAG_KINDS: readonly KnowledgeFlagKind[] = ["missing", "wrong", "stale"];

/**
 * Evidence is deliberately open: a quote, a list of quotes, or a structured object (run id,
 * trace url, query). It must be JSON-serializable and bounded.
 */
export type KnowledgeEvidence = string | string[] | { [key: string]: unknown };

export interface KnowledgeFlag {
  kind: KnowledgeFlagKind;
  /** Normalized concept reference (bundle path without `.md`), or null when the flag names no doc. */
  ref: string | null;
  suggestedFix: string | null;
  evidence: KnowledgeEvidence | null;
}

export type KnowledgeFlagErrorCode =
  | "FLAG_NOT_OBJECT"
  | "FLAG_KIND_MISSING"
  | "FLAG_KIND_INVALID"
  | "FLAG_REF_INVALID"
  | "FLAG_FIX_INVALID"
  | "FLAG_EVIDENCE_INVALID";

export class KnowledgeFlagError extends Error {
  readonly code: KnowledgeFlagErrorCode;

  constructor(code: KnowledgeFlagErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeFlagError";
    this.code = code;
  }
}

function fail(code: KnowledgeFlagErrorCode, message: string): never {
  throw new KnowledgeFlagError(code, message);
}

export const MAX_FLAG_REF = 500;
export const MAX_FLAG_FIX = 8000;
export const MAX_FLAG_EVIDENCE = 16000;

/** Trims and canonicalizes a concept reference. Returns null for an absent/empty ref. */
export function normalizeFlagRef(ref: unknown): string | null {
  if (ref === undefined || ref === null) return null;
  if (typeof ref !== "string") fail("FLAG_REF_INVALID", `ref must be a string, got ${typeof ref}`);
  const collapsed = ref.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  let s = collapsed;
  // External URIs are kept exactly as written (a scheme's `//` is meaningful).
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s)) return s;
  s = s.replace(/^\.\//, "").replace(/^\/+/, "");
  s = s.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  if (s.toLowerCase().endsWith(".md")) s = s.slice(0, -3);
  if (s === "") fail("FLAG_REF_INVALID", `ref "${ref}" normalizes to nothing`);
  if (/[\u0000-\u001f\u007f]/.test(s)) fail("FLAG_REF_INVALID", "ref contains control characters");
  if (s.length > MAX_FLAG_REF) fail("FLAG_REF_INVALID", `ref must be at most ${MAX_FLAG_REF} characters`);
  return s;
}

function normalizeFix(fix: unknown): string | null {
  if (fix === undefined || fix === null) return null;
  if (typeof fix !== "string") fail("FLAG_FIX_INVALID", `suggestedFix must be a string, got ${typeof fix}`);
  const s = fix.trim();
  if (s === "") return null;
  if (s.length > MAX_FLAG_FIX) fail("FLAG_FIX_INVALID", `suggestedFix must be at most ${MAX_FLAG_FIX} characters`);
  return s;
}

function jsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return t === "number" ? Number.isFinite(value as number) : true;
  if (t === "undefined" || t === "function" || t === "bigint" || t === "symbol") return false;
  if (Array.isArray(value)) return value.every((item) => jsonSafe(item, depth + 1));
  if (t === "object") {
    for (const v of Object.values(value as { [key: string]: unknown })) {
      if (!jsonSafe(v, depth + 1)) return false;
    }
    return true;
  }
  return false;
}

function normalizeEvidence(evidence: unknown): KnowledgeEvidence | null {
  if (evidence === undefined || evidence === null) return null;
  if (typeof evidence === "string") {
    const s = evidence.trim();
    if (s === "") return null;
    if (s.length > MAX_FLAG_EVIDENCE) {
      fail("FLAG_EVIDENCE_INVALID", `evidence must be at most ${MAX_FLAG_EVIDENCE} characters`);
    }
    return s;
  }
  if (Array.isArray(evidence)) {
    if (!evidence.every((item) => typeof item === "string")) {
      fail("FLAG_EVIDENCE_INVALID", "evidence arrays must contain only strings");
    }
    const items = (evidence as string[]).map((item) => item.trim()).filter((item) => item !== "");
    if (items.length === 0) return null;
    if (JSON.stringify(items).length > MAX_FLAG_EVIDENCE) {
      fail("FLAG_EVIDENCE_INVALID", `evidence must serialize to at most ${MAX_FLAG_EVIDENCE} characters`);
    }
    return items;
  }
  if (typeof evidence === "object") {
    if (!jsonSafe(evidence)) fail("FLAG_EVIDENCE_INVALID", "evidence must be JSON-serializable");
    try {
      if (JSON.stringify(evidence).length > MAX_FLAG_EVIDENCE) {
        fail("FLAG_EVIDENCE_INVALID", `evidence must serialize to at most ${MAX_FLAG_EVIDENCE} characters`);
      }
    } catch {
      fail("FLAG_EVIDENCE_INVALID", "evidence must be JSON-serializable");
    }
    return evidence as { [key: string]: unknown };
  }
  fail("FLAG_EVIDENCE_INVALID", `evidence must be a string, string array, or object, got ${typeof evidence}`);
}

/** Validates and normalizes one raw flag payload. Throws KnowledgeFlagError on bad input. */
export function parseKnowledgeFlag(raw: unknown): KnowledgeFlag {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("FLAG_NOT_OBJECT", "flag_knowledge payload must be an object");
  }
  const record = raw as { [key: string]: unknown };
  const kindRaw = record.kind;
  if (kindRaw === undefined || kindRaw === null || String(kindRaw).trim() === "") {
    fail("FLAG_KIND_MISSING", "flag_knowledge requires kind: missing | wrong | stale");
  }
  if (typeof kindRaw !== "string") fail("FLAG_KIND_INVALID", `kind must be a string, got ${typeof kindRaw}`);
  const kind = kindRaw.trim().toLowerCase();
  if (!KNOWLEDGE_FLAG_KINDS.includes(kind as KnowledgeFlagKind)) {
    fail("FLAG_KIND_INVALID", `kind "${kindRaw}" is not one of ${KNOWLEDGE_FLAG_KINDS.join(" | ")}`);
  }
  return {
    kind: kind as KnowledgeFlagKind,
    ref: normalizeFlagRef(record.ref),
    suggestedFix: normalizeFix(record.suggestedFix),
    evidence: normalizeEvidence(record.evidence),
  };
}

export type FlagParseResult = { ok: true; flag: KnowledgeFlag } | { ok: false; error: KnowledgeFlagError };

export function tryParseKnowledgeFlag(raw: unknown): FlagParseResult {
  try {
    return { ok: true, flag: parseKnowledgeFlag(raw) };
  } catch (error) {
    if (error instanceof KnowledgeFlagError) return { ok: false, error };
    throw error;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object" && value !== null) {
    const out: { [key: string]: unknown } = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue((value as { [key: string]: unknown })[key]);
    return out;
  }
  return value;
}

/** Stable identity for a normalized flag. Identical observations collapse; order-independent. */
export function flagId(flag: KnowledgeFlag): string {
  const canonical = JSON.stringify(
    stableValue([flag.kind, flag.ref, flag.suggestedFix, flag.evidence]),
  );
  return `flag_${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Removes identical flags, keeping first occurrence order. */
export function dedupeFlags(flags: KnowledgeFlag[]): KnowledgeFlag[] {
  const seen = new Set<string>();
  const out: KnowledgeFlag[] = [];
  for (const flag of flags) {
    const id = flagId(flag);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(flag);
  }
  return out;
}

export function countDuplicateFlags(flags: KnowledgeFlag[]): number {
  return flags.length - dedupeFlags(flags).length;
}

/** Groups flags by normalized ref (null refs grouped under ""). Deterministic key order. */
export function groupFlagsByRef(flags: KnowledgeFlag[]): Array<{ ref: string; flags: KnowledgeFlag[] }> {
  const groups = new Map<string, KnowledgeFlag[]>();
  for (const flag of flags) {
    const key = flag.ref ?? "";
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [flag]);
    else bucket.push(flag);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
    .map(([ref, groupFlags]) => ({ ref, flags: groupFlags }));
}
