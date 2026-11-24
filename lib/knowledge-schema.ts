// OKF v0.3-shaped knowledge schema for Dock's WS3 knowledge factory.
//
// Pure validation: no I/O, no framework imports, stdlib crypto only, so node --test can load it
// directly. Dock deliberately profiles OKF v0.3 rather than adopting it wholesale:
//
//   - `type` is restricted to the three LangChain knowledge types (skill | domain | data_access),
//     where OKF leaves type open. Unknown values fail closed.
//   - `status` uses Dock's lifecycle vocabulary (active | stale | superseded), where OKF v0.3
//     natively uses stable | draft | deprecated.
//   - `sources[].resource` is optional in the Dock profile (OKF requires it) so a curator proposal
//     can carry credibility signals alone.
//   - A concept must have a non-empty body (all three types), and `domain` requires a description
//     while `data_access` requires a resource.
//
// Everything else follows OKF v0.3 sections 4-9: frontmatter shape, actor convention, trust tiers
// computed only from current verification events, stale_after freshness, supersession, index.md,
// and append-only log.md. Unknown frontmatter keys are preserved as extensions (OKF 4.1).
import { createHash } from "crypto";

export type KnowledgeType = "skill" | "domain" | "data_access";
export type KnowledgeStatus = "active" | "stale" | "superseded";
export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
export type Freshness = "fresh" | "stale" | "malformed" | "unknown";

export const KNOWLEDGE_TYPES: readonly KnowledgeType[] = ["skill", "domain", "data_access"];
export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = ["active", "stale", "superseded"];
export const TRUST_TIERS: readonly TrustTier[] = ["unverified", "machine-confirmed", "human-reviewed"];

export const TRUST_TIER_RANK: Record<TrustTier, number> = {
  unverified: 0,
  "machine-confirmed": 1,
  "human-reviewed": 2,
};

export function rankTrustTier(tier: TrustTier): number {
  return TRUST_TIER_RANK[tier];
}

export type KnowledgeErrorCode =
  | "FRONTMATTER_MISSING"
  | "FRONTMATTER_UNTERMINATED"
  | "YAML_INVALID"
  | "DUPLICATE_KEY"
  | "TYPE_MISSING"
  | "TYPE_INVALID"
  | "FIELD_INVALID"
  | "STATUS_INVALID"
  | "DATE_INVALID"
  | "SUPERSEDED_BY_WITHOUT_STATUS"
  | "SUPERSEDED_TARGET_MISSING"
  | "SUPERSEDED_CYCLE"
  | "BUNDLE_PATH_INVALID"
  | "INDEX_FRONTMATTER_OUTSIDE_ROOT"
  | "LOG_FRONTMATTER"
  | "LOG_HEADING_INVALID"
  | "LOG_ORDER_INVALID"
  | "CONCEPT_ID_COLLISION";

/** Typed schema failure. `code` is stable; `path` is the frontmatter field or bundle file. */
export class KnowledgeSchemaError extends Error {
  readonly code: KnowledgeErrorCode;
  readonly path?: string;

  constructor(code: KnowledgeErrorCode, message: string, path?: string) {
    super(message);
    this.name = "KnowledgeSchemaError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

function fail(code: KnowledgeErrorCode, message: string, path?: string): never {
  throw new KnowledgeSchemaError(code, message, path);
}

// ---------------------------------------------------------------------------
// YAML subset parser (block mappings/sequences, flow mappings/sequences, quoted scalars)
// ---------------------------------------------------------------------------

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface YamlLine {
  indent: number;
  text: string;
  line: number;
}

function isPlainObject(v: unknown): v is { [key: string]: YamlValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Removes a trailing `# comment`, respecting single/double quotes. */
function stripYamlComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (quote === '"' && ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function toYamlLines(text: string): YamlLine[] {
  const out: YamlLine[] = [];
  const raw = text.split(/\r?\n/);
  for (let i = 0; i < raw.length; i += 1) {
    const cleaned = stripYamlComment(raw[i]);
    if (cleaned.trim() === "") continue;
    const indent = cleaned.match(/^ */)?.[0].length ?? 0;
    out.push({ indent, text: cleaned.trim(), line: i + 1 });
  }
  return out;
}

function unquoteYamlScalar(raw: string, line: number): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const body = s.slice(1, -1);
    return body.replace(/\\(.)/g, (_m, ch: string) => {
      if (ch === "n") return "\n";
      if (ch === "t") return "\t";
      if (ch === "r") return "\r";
      return ch;
    });
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if ((s.startsWith('"') && !s.endsWith('"')) || (s.startsWith("'") && !s.endsWith("'"))) {
    fail("YAML_INVALID", `line ${line}: unterminated quoted string`, String(line));
  }
  return s;
}

/** Splits `a, b, c` at top level, respecting quotes and nested brackets. */
function splitFlowParts(body: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote !== null) {
      current += ch;
      if (quote === '"' && ch === "\\") {
        current += body[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0) fail("YAML_INVALID", `line ${line}: unbalanced flow collection`, String(line));
  const last = current.trim();
  if (last !== "") parts.push(last);
  return parts;
}

function parseFlowSequence(body: string, line: number): YamlValue[] {
  const inner = body.slice(1, -1).trim();
  if (inner === "") return [];
  return splitFlowParts(inner, line).map((p) => parseYamlScalar(p, line));
}

function parseFlowMapping(body: string, line: number): { [key: string]: YamlValue } {
  const inner = body.slice(1, -1).trim();
  const out: { [key: string]: YamlValue } = {};
  if (inner === "") return out;
  for (const part of splitFlowParts(inner, line)) {
    const idx = part.indexOf(":");
    if (idx <= 0) fail("YAML_INVALID", `line ${line}: expected "key: value" in flow mapping`, String(line));
    const key = unquoteYamlScalar(part.slice(0, idx).trim(), line);
    const value = part.slice(idx + 1).trim();
    if (Object.prototype.hasOwnProperty.call(out, key)) fail("DUPLICATE_KEY", `line ${line}: duplicate key "${key}"`, key);
    out[key] = parseYamlScalar(value === "" ? "null" : value, line);
  }
  return out;
}

function parseYamlScalar(raw: string, line: number): YamlValue {
  const s = raw.trim();
  if (s.startsWith('"') || s.startsWith("'")) return unquoteYamlScalar(s, line);
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) fail("YAML_INVALID", `line ${line}: unterminated flow sequence`, String(line));
    return parseFlowSequence(s, line);
  }
  if (s.startsWith("{")) {
    if (!s.endsWith("}")) fail("YAML_INVALID", `line ${line}: unterminated flow mapping`, String(line));
    return parseFlowMapping(s, line);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseYamlMap(lines: YamlLine[], start: number, indent: number): { value: { [key: string]: YamlValue }; next: number } {
  const out: { [key: string]: YamlValue } = {};
  const seen = new Set<string>();
  let i = start;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent < indent) break;
    if (ln.indent > indent) fail("YAML_INVALID", `line ${ln.line}: unexpected indentation`, String(ln.line));
    if (ln.text === "-" || ln.text.startsWith("- ")) break;
    const match = ln.text.match(/^([^:]+):(?:\s+(.*))?$/);
    if (!match) fail("YAML_INVALID", `line ${ln.line}: expected "key: value"`, String(ln.line));
    const key = unquoteYamlScalar(match[1].trim(), ln.line);
    if (seen.has(key)) fail("DUPLICATE_KEY", `line ${ln.line}: duplicate key "${key}"`, key);
    seen.add(key);
    const rest = match[2] === undefined ? "" : match[2].trim();
    if (rest !== "") {
      out[key] = parseYamlScalar(rest, ln.line);
      i += 1;
      continue;
    }
    const nextLine = lines[i + 1];
    if (nextLine !== undefined && nextLine.indent > indent) {
      const parsed = parseYamlNode(lines, i + 1, nextLine.indent);
      out[key] = parsed.value;
      i = parsed.next;
      continue;
    }
    if (nextLine !== undefined && nextLine.indent === indent && (nextLine.text === "-" || nextLine.text.startsWith("- "))) {
      const parsed = parseYamlSequence(lines, i + 1, indent);
      out[key] = parsed.value;
      i = parsed.next;
      continue;
    }
    out[key] = null;
    i += 1;
  }
  return { value: out, next: i };
}

function parseYamlSequence(lines: YamlLine[], start: number, indent: number): { value: YamlValue[]; next: number } {
  const out: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.indent !== indent) break;
    if (ln.text !== "-" && !ln.text.startsWith("- ")) break;
    const rest = ln.text === "-" ? "" : ln.text.slice(2).trim();
    if (rest === "") {
      const nextLine = lines[i + 1];
      if (nextLine !== undefined && nextLine.indent > indent) {
        const parsed = parseYamlNode(lines, i + 1, nextLine.indent);
        out.push(parsed.value);
        i = parsed.next;
      } else {
        out.push(null);
        i += 1;
      }
      continue;
    }
    if (/^([^:]+):(?:\s+(.*))?$/.test(rest)) {
      // Sequence item that starts an inline mapping (`- id: x`).
      const itemIndent = indent + 2;
      const sub: YamlLine[] = [{ indent: itemIndent, text: rest, line: ln.line }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        sub.push(lines[j]);
        j += 1;
      }
      const parsed = parseYamlNode(sub, 0, itemIndent);
      if (!isPlainObject(parsed.value)) fail("YAML_INVALID", `line ${ln.line}: sequence item must be a mapping`, String(ln.line));
      out.push(parsed.value);
      i = j;
      continue;
    }
    out.push(parseYamlScalar(rest, ln.line));
    i += 1;
  }
  return { value: out, next: i };
}

function parseYamlNode(lines: YamlLine[], start: number, indent: number): { value: YamlValue; next: number } {
  const first = lines[start];
  if (first === undefined || first.indent < indent) return { value: null, next: start };
  if (first.text === "-" || first.text.startsWith("- ")) return parseYamlSequence(lines, start, indent);
  return parseYamlMap(lines, start, indent);
}

/** Parses the frontmatter block as a YAML mapping. Throws typed errors; never guesses. */
export function parseFrontmatterYaml(text: string): { [key: string]: YamlValue } {
  const lines = toYamlLines(text);
  if (lines.length === 0) return {};
  const parsed = parseYamlNode(lines, 0, lines[0].indent);
  if (!isPlainObject(parsed.value)) {
    fail("YAML_INVALID", "frontmatter must be a YAML mapping", "frontmatter");
  }
  if (parsed.next !== lines.length) {
    const ln = lines[parsed.next];
    fail("YAML_INVALID", `line ${ln.line}: could not parse this line`, String(ln.line));
  }
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Dates, paths, actors
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?\s*(Z|z|[+-]\d{2}:?\d{2})$/;

/**
 * Parses the OKF v0.3 timestamp profile: RFC 3339 date-time with an offset, or a date (UTC midnight).
 * Returns epoch milliseconds, or null when the value cannot be read.
 */
export function parseOkfTimestamp(value: string): number | null {
  const s = value.trim();
  const dateMatch = DATE_ONLY.exec(s);
  if (dateMatch !== null) {
    const [, y, m, d] = dateMatch;
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
    return isValidUtc(ms, Number(y), Number(m), Number(d)) ? ms : null;
  }
  const dtMatch = DATE_TIME.exec(s);
  if (dtMatch !== null) {
    const [, y, mo, d, h, mi, sec, frac, tz] = dtMatch;
    const ms = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(sec ?? 0),
      frac === undefined ? 0 : Number((frac + "000").slice(0, 3)),
    );
    if (!isValidUtc(ms, Number(y), Number(mo), Number(d))) return null;
    const iso = new Date(ms).toISOString();
    const withZone = tz === "Z" || tz === "z" ? iso : iso.replace("Z", tzNormalized(tz));
    const parsed = Date.parse(withZone);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function tzNormalized(tz: string): string {
  return tz.includes(":") ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
}

function isValidUtc(ms: number, y: number, m: number, d: number): boolean {
  const dt = new Date(ms);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

export type NowInput = number | string | Date;

export function resolveNow(now?: NowInput): number {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number") {
    if (!Number.isFinite(now)) fail("DATE_INVALID", `"now" must be a finite epoch millisecond value`);
    return now;
  }
  const parsed = parseOkfTimestamp(now);
  if (parsed === null) fail("DATE_INVALID", `invalid "now" timestamp: ${now}`);
  return parsed;
}

/** Normalizes a bundle path or concept reference to an id (no `.md`, no leading slash). */
export function normalizeKnowledgePath(ref: string): string {
  let s = ref.trim().replace(/\\/g, "/");
  if (s === "") return "";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s)) return s; // external URI, kept as written
  s = s.replace(/^\.\//, "").replace(/^\/+/, "");
  s = s.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  if (s.toLowerCase().endsWith(".md")) s = s.slice(0, -3);
  return s;
}

const ACTOR_PRODUCER = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s/]+$/;
const ACTOR_SCHEME = /^[A-Za-z0-9][A-Za-z0-9._-]*:[^\s]+$/;

export function isHumanActor(by: string): boolean {
  return by.startsWith("human:") && by.length > "human:".length;
}

function assertActor(value: unknown, field: string): string {
  if (typeof value !== "string") fail("FIELD_INVALID", `${field}: actor must be a string`, field);
  const actor = value.trim();
  if (actor === "" || (!ACTOR_PRODUCER.test(actor) && !ACTOR_SCHEME.test(actor))) {
    fail("FIELD_INVALID", `${field}: invalid actor "${actor}" (use "<producer>/<version>" or "<scheme>:<id>")`, field);
  }
  return actor;
}

// ---------------------------------------------------------------------------
// Frontmatter model
// ---------------------------------------------------------------------------

export interface KnowledgeSource {
  id: string | null;
  resource: string | null;
  title: string | null;
  author: string | null;
  usage_count: number | null;
  last_modified: string | null;
  extensions: { [key: string]: unknown };
}

export interface GeneratedEvent {
  by: string;
  at: string | null;
  extensions: { [key: string]: unknown };
}

export interface VerificationEvent {
  by: string;
  at: string;
  extensions: { [key: string]: unknown };
}

export interface KnowledgeFrontmatter {
  type: KnowledgeType;
  title: string | null;
  description: string | null;
  resource: string | null;
  tags: string[];
  status: KnowledgeStatus;
  /** Legacy OKF v0.1 timestamp; used as generated.at only when generated is absent. */
  timestamp: string | null;
  stale_after: string | null;
  superseded_by: string | null;
  generated: GeneratedEvent | null;
  verified: VerificationEvent[];
  sources: KnowledgeSource[];
  extensions: { [key: string]: unknown };
}

export interface KnowledgeDocument {
  id: string;
  path: string;
  type: KnowledgeType;
  frontmatter: KnowledgeFrontmatter;
  body: string;
  trustTier: TrustTier;
  freshness: Freshness;
  contentHash: string;
  evaluatedAt: number;
  raw: string;
}

export interface GeneratedVerificationInput {
  generated?: GeneratedEvent | null;
  verified?: VerificationEvent[];
  timestamp?: string | null;
}

export interface VerificationCurrency {
  /** Last meaningful content change (generated.at, or legacy timestamp). Null when unknown. */
  baseline: number | null;
  current: VerificationEvent[];
  earlier: VerificationEvent[];
}

/**
 * OKF 5.3: a verification is current when its `at` is at or after the last meaningful content
 * change, or when `generated` is absent. Earlier events stay history; they do not count.
 */
export function verificationCurrency(input: GeneratedVerificationInput): VerificationCurrency {
  const verified = input.verified ?? [];
  let baseline: number | null = null;
  if (input.generated?.at) {
    baseline = parseOkfTimestamp(input.generated.at);
  } else if (!input.generated && input.timestamp) {
    baseline = parseOkfTimestamp(input.timestamp);
  }
  const current: VerificationEvent[] = [];
  const earlier: VerificationEvent[] = [];
  for (const event of verified) {
    const at = parseOkfTimestamp(event.at);
    if (at === null) {
      earlier.push(event);
      continue;
    }
    if (baseline === null || at >= baseline) current.push(event);
    else earlier.push(event);
  }
  return { baseline, current, earlier };
}

/** Computes the trust tier from current verification events only. */
export function computeTrustTier(input: GeneratedVerificationInput): TrustTier {
  const { current } = verificationCurrency(input);
  if (current.length === 0) return "unverified";
  return current.some((event) => isHumanActor(event.by)) ? "human-reviewed" : "machine-confirmed";
}

export function computeFreshness(fm: Pick<KnowledgeFrontmatter, "stale_after">, nowMs: number): Freshness {
  if (fm.stale_after === null) return "unknown";
  const at = parseOkfTimestamp(fm.stale_after);
  if (at === null) return "malformed";
  return nowMs >= at ? "stale" : "fresh";
}

export interface TrustTierChange {
  before: TrustTier;
  after: TrustTier;
  changed: boolean;
  demoted: boolean;
}

/** Compares two frontmatter states. Demotion is a lowered trust tier (edit after review). */
export function trustTierChange(
  before: GeneratedVerificationInput,
  after: GeneratedVerificationInput,
): TrustTierChange {
  const from = computeTrustTier(before);
  const to = computeTrustTier(after);
  const demoted = rankTrustTier(to) < rankTrustTier(from);
  return { before: from, after: to, changed: from !== to, demoted };
}

/**
 * Dock demotion rule: when a content edit follows a human review, the concept is reported as
 * machine-confirmed until a person reviews the new text -- even though OKF 5.3 finds no current
 * verification in that state. The curator records its own machine verification alongside edits so
 * the computed tier and this rule agree. A newer human event always wins.
 */
export function demoteAfterEdit(before: TrustTier, after: GeneratedVerificationInput): TrustTier {
  const natural = computeTrustTier(after);
  if (rankTrustTier(natural) >= rankTrustTier(before)) return natural;
  if (before === "human-reviewed") return "machine-confirmed";
  return natural;
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

const KNOWN_TOP_LEVEL = new Set([
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "timestamp",
  "status",
  "stale_after",
  "superseded_by",
  "generated",
  "verified",
  "sources",
]);

function fieldInvalid(field: string, message: string): never {
  return fail("FIELD_INVALID", `${field}: ${message}`, field);
}

function optionalString(value: unknown, field: string, max = 2000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fieldInvalid(field, "must be a string");
  const s = value.trim();
  if (s === "") return null;
  if (s.length > max) fieldInvalid(field, `must be at most ${max} characters`);
  return s;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fieldInvalid(field, "must be an RFC 3339 timestamp string");
  const s = value.trim();
  if (s === "") return null;
  if (parseOkfTimestamp(s) === null) {
    return fail("DATE_INVALID", `${field}: "${s}" is not an RFC 3339 date-time with offset or a date`, field);
  }
  return s;
}

function optionalTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value]; // OKF: a scalar tag is one tag, never comma-split.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") fieldInvalid("tags", "every tag must be a string");
    const tag = item.trim();
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function extensionsOf(raw: { [key: string]: YamlValue }, known: Set<string>): { [key: string]: unknown } {
  const out: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) out[key] = value;
  }
  return out;
}

function parseGenerated(value: unknown): GeneratedEvent | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) fieldInvalid("generated", "must be a mapping like { by: <actor>, at: <timestamp> }");
  const by = assertActor(value.by, "generated.by");
  const at = optionalTimestamp(value.at, "generated.at");
  return { by, at, extensions: extensionsOf(value, new Set(["by", "at"])) };
}

function parseVerified(value: unknown): VerificationEvent[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value]; // OKF: a bare mapping is one event.
  return items.map((item, index) => {
    const field = `verified[${index}]`;
    if (!isPlainObject(item)) fieldInvalid(field, "each verification must be a mapping like { by, at }");
    const by = assertActor(item.by, `${field}.by`);
    if (item.at === undefined || item.at === null) fieldInvalid(`${field}.at`, "verification events require both by and at");
    const at = optionalTimestamp(item.at, `${field}.at`);
    if (at === null) fieldInvalid(`${field}.at`, "verification events require both by and at");
    return { by, at, extensions: extensionsOf(item, new Set(["by", "at"])) };
  });
}

function parseSources(value: unknown): KnowledgeSource[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value]; // OKF: one entry may be written without the dash.
  return items.map((item, index) => {
    const field = `sources[${index}]`;
    if (!isPlainObject(item)) fieldInvalid(field, "each source must be a mapping");
    const known = new Set(["id", "resource", "title", "author", "usage_count", "last_modified"]);
    const source: KnowledgeSource = {
      id: null,
      resource: null,
      title: null,
      author: null,
      usage_count: null,
      last_modified: null,
      extensions: extensionsOf(item, known),
    };
    source.id = optionalString(item.id, `${field}.id`);
    source.resource = optionalString(item.resource, `${field}.resource`);
    source.title = optionalString(item.title, `${field}.title`);
    source.author =
      item.author === undefined || item.author === null ? null : assertActor(item.author, `${field}.author`);
    if (item.usage_count !== undefined && item.usage_count !== null) {
      if (typeof item.usage_count !== "number" || !Number.isInteger(item.usage_count) || item.usage_count < 0) {
        fieldInvalid(`${field}.usage_count`, "must be a non-negative integer");
      }
      source.usage_count = item.usage_count;
    }
    source.last_modified = optionalTimestamp(item.last_modified, `${field}.last_modified`);
    return source;
  });
}

function parseStatus(value: unknown): KnowledgeStatus {
  const status = optionalString(value, "status", 40);
  if (status === null) return "active";
  if (!KNOWLEDGE_STATUSES.includes(status as KnowledgeStatus)) {
    return fail("STATUS_INVALID", `status "${status}" is not one of ${KNOWLEDGE_STATUSES.join(" | ")}`, "status");
  }
  return status as KnowledgeStatus;
}

function parseSupersededBy(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let raw: unknown = value;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) fieldInvalid("superseded_by", "OKF v0.3 allows exactly one replacement path");
    raw = raw[0];
  }
  const s = optionalString(raw, "superseded_by", 500);
  if (s === null) return null;
  const normalized = normalizeKnowledgePath(s);
  if (normalized === "") fieldInvalid("superseded_by", "must name a concept path or external URI");
  return normalized;
}

function buildFrontmatter(raw: { [key: string]: YamlValue }, path: string): KnowledgeFrontmatter {
  const typeRaw = raw.type;
  if (typeRaw === undefined || typeRaw === null || (typeof typeRaw === "string" && typeRaw.trim() === "")) {
    return fail("TYPE_MISSING", `${path}: frontmatter requires a non-empty "type"`, "type");
  }
  if (typeof typeRaw !== "string") {
    return fail("TYPE_INVALID", `${path}: "type" must be a string`, "type");
  }
  const type = typeRaw.trim() as KnowledgeType;
  if (!KNOWLEDGE_TYPES.includes(type)) {
    return fail(
      "TYPE_INVALID",
      `${path}: type "${type}" is not one of ${KNOWLEDGE_TYPES.join(" | ")}`,
      "type",
    );
  }

  const status = parseStatus(raw.status);
  const supersededBy = parseSupersededBy(raw.superseded_by);
  if (supersededBy !== null && status !== "superseded") {
    fail("SUPERSEDED_BY_WITHOUT_STATUS", "superseded_by is only meaningful when status is \"superseded\"", "superseded_by");
  }

  return {
    type,
    title: optionalString(raw.title, "title"),
    description: optionalString(raw.description, "description"),
    resource: optionalString(raw.resource, "resource"),
    tags: optionalTags(raw.tags),
    status,
    timestamp: optionalTimestamp(raw.timestamp, "timestamp"),
    stale_after: optionalTimestamp(raw.stale_after, "stale_after"),
    superseded_by: supersededBy,
    generated: parseGenerated(raw.generated),
    verified: parseVerified(raw.verified),
    sources: parseSources(raw.sources),
    extensions: extensionsOf(raw, KNOWN_TOP_LEVEL),
  };
}

/** Dock profile: every type needs a body; domain needs a description; data_access needs a resource. */
function assertTypeRequirements(fm: KnowledgeFrontmatter, body: string, path: string): void {
  if (body.trim() === "") fieldInvalid("body", `${path}: a ${fm.type} knowledge document requires a non-empty body`);
  if (fm.type === "domain" && fm.description === null) {
    fieldInvalid("description", `${path}: domain knowledge requires a one-line description`);
  }
  if (fm.type === "data_access" && fm.resource === null) {
    fieldInvalid("resource", `${path}: data_access knowledge requires a resource naming the source to query`);
  }
}

// ---------------------------------------------------------------------------
// Document parsing, canonical serialization, rendering
// ---------------------------------------------------------------------------

export interface ParseDocumentOptions {
  /** File path inside the bundle. Defaults to "concept.md". */
  path?: string;
  now?: NowInput;
}

function splitFrontmatter(text: string, label: string): { front: string; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== "---") {
    fail("FRONTMATTER_MISSING", `${label}: missing frontmatter (must start with ---)`);
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) fail("FRONTMATTER_UNTERMINATED", `${label}: unterminated frontmatter (no closing ---)`);
  return { front: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
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

function canonicalBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

/** Deterministic JSON form used for hashing and diffs: sorted keys, normalized body. */
export function canonicalSerialize(doc: { frontmatter: KnowledgeFrontmatter; body: string }): string {
  return `${JSON.stringify(stableValue({ frontmatter: doc.frontmatter, body: canonicalBody(doc.body) }), null, 2)}\n`;
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex");
}

export interface KnowledgeDocumentParts {
  frontmatter: KnowledgeFrontmatter;
  body: string;
}

/** Parses and validates one Markdown + YAML knowledge document. Throws KnowledgeSchemaError. */
export function parseKnowledgeDocument(text: string, opts: ParseDocumentOptions = {}): KnowledgeDocument {
  const requestedPath = opts.path ?? "concept.md";
  const id = normalizeKnowledgePath(requestedPath) || "concept";
  const path = id.includes(":") ? requestedPath : `${id}.md`;
  const label = requestedPath;
  const { front, body } = splitFrontmatter(text, label);
  const raw = parseFrontmatterYaml(front);
  const frontmatter = buildFrontmatter(raw, label);
  assertTypeRequirements(frontmatter, body, label);

  const now = resolveNow(opts.now);
  const trustTier = computeTrustTier(frontmatter);
  return {
    id,
    path,
    type: frontmatter.type,
    frontmatter,
    body,
    trustTier,
    freshness: computeFreshness(frontmatter, now),
    contentHash: hashCanonical({ frontmatter, body: canonicalBody(body) }),
    evaluatedAt: now,
    raw: text,
  };
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value);
  if (s === "") return '""';
  if (/^(true|false|null|~)$/i.test(s)) return JSON.stringify(s);
  if (/^[A-Za-z0-9_./@+-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function renderExtensionValue(value: unknown, indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}[]`);
      return;
    }
    lines.push("");
    for (const item of value) {
      if (isPlainObject(item) || Array.isArray(item)) {
        lines.push(`${pad}-`);
        renderExtensionValue(item, indent + 2, lines);
      } else {
        lines.push(`${pad}- ${yamlScalar(item)}`);
      }
    }
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      lines.push(`${pad}{}`);
      return;
    }
    lines.push("");
    for (const key of keys) renderExtensionKeyValue(key, value[key], indent, lines);
    return;
  }
  lines.push(`${pad}${yamlScalar(value)}`);
}

function renderExtensionKeyValue(key: string, value: unknown, indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    lines.push(`${pad}${key}:`);
    for (const k of Object.keys(value).sort()) renderExtensionKeyValue(k, value[k], indent + 2, lines);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}${key}: []`);
      return;
    }
    lines.push(`${pad}${key}:`);
    for (const item of value) {
      if (isPlainObject(item) && Object.keys(item).length > 0) {
        const first = Object.keys(item).sort()[0];
        const rest = { ...item };
        delete rest[first];
        lines.push(`${pad}  - ${first}: ${yamlScalar(item[first])}`);
        for (const k of Object.keys(rest).sort()) renderExtensionKeyValue(k, rest[k], indent + 4, lines);
      } else if (Array.isArray(item)) {
        lines.push(`${pad}  -`);
        renderExtensionValue(item, indent + 4, lines);
      } else {
        lines.push(`${pad}  - ${yamlScalar(item)}`);
      }
    }
    return;
  }
  lines.push(`${pad}${key}: ${yamlScalar(value)}`);
}

/** Emits the document as portable OKF-shaped Markdown. Round-trips through parseKnowledgeDocument. */
export function serializeDocument(doc: KnowledgeDocumentParts): string {
  const fm = doc.frontmatter;
  const lines: string[] = ["---", `type: ${yamlScalar(fm.type)}`];
  if (fm.title !== null) lines.push(`title: ${yamlScalar(fm.title)}`);
  if (fm.description !== null) lines.push(`description: ${yamlScalar(fm.description)}`);
  if (fm.resource !== null) lines.push(`resource: ${yamlScalar(fm.resource)}`);
  if (fm.tags.length > 0) lines.push(`tags: [${fm.tags.map(yamlScalar).join(", ")}]`);
  lines.push(`status: ${yamlScalar(fm.status)}`);
  if (fm.timestamp !== null) lines.push(`timestamp: ${yamlScalar(fm.timestamp)}`);
  if (fm.stale_after !== null) lines.push(`stale_after: ${yamlScalar(fm.stale_after)}`);
  if (fm.superseded_by !== null) lines.push(`superseded_by: ${yamlScalar(fm.superseded_by)}`);
  if (fm.generated !== null) {
    const parts = [`by: ${yamlScalar(fm.generated.by)}`];
    if (fm.generated.at !== null) parts.push(`at: ${yamlScalar(fm.generated.at)}`);
    lines.push(`generated: { ${parts.join(", ")} }`);
    for (const [key, value] of Object.entries(fm.generated.extensions)) {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  if (fm.verified.length > 0) {
    lines.push("verified:");
    for (const event of fm.verified) {
      lines.push(`  - by: ${yamlScalar(event.by)}`);
      lines.push(`    at: ${yamlScalar(event.at)}`);
    }
  }
  if (fm.sources.length > 0) {
    lines.push("sources:");
    for (const source of fm.sources) {
      const keys = ["id", "resource", "title", "author", "usage_count", "last_modified"] as const;
      let first = true;
      for (const key of keys) {
        const value = source[key];
        if (value === undefined || value === null) continue;
        lines.push(`${first ? "  - " : "    "}${key}: ${yamlScalar(value)}`);
        first = false;
      }
      for (const [key, value] of Object.entries(source.extensions)) {
        lines.push(`    ${key}: ${yamlScalar(value)}`);
      }
      if (first) lines.push("  - {}");
    }
  }
  for (const key of Object.keys(fm.extensions).sort()) {
    const value = fm.extensions[key];
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      lines.push(`${key}:`);
      for (const k of Object.keys(value).sort()) renderExtensionKeyValue(k, value[k], 2, lines);
    } else if (Array.isArray(value)) {
      renderExtensionKeyValue(key, value, 0, lines);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---");
  const body = doc.body;
  return body === "" ? `${lines.join("\n")}\n` : `${lines.join("\n")}\n${body}`;
}

// ---------------------------------------------------------------------------
// Bundles: index.md, log.md, concepts, supersession graph
// ---------------------------------------------------------------------------

export interface BundleFile {
  path: string;
  text: string;
}

export interface BundleIndexMetadata {
  okf_version: string | null;
  title: string | null;
  description: string | null;
  license: string | null;
  extensions: { [key: string]: unknown };
}

export interface BundleLog {
  path: string;
  dates: string[];
  entryCount: number;
  body: string;
}

export interface KnowledgeBundle {
  index: BundleIndexMetadata | null;
  logs: BundleLog[];
  documents: KnowledgeDocument[];
  byId: { [id: string]: KnowledgeDocument };
}

function normalizeBundlePath(raw: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    fail("BUNDLE_PATH_INVALID", "bundle file path must be a non-empty string");
  }
  let s = raw.trim().replace(/\\/g, "/");
  if (s.startsWith("/")) s = s.slice(1);
  const segments = s.split("/");
  if (segments.some((segment) => segment === "..")) {
    fail("BUNDLE_PATH_INVALID", `"${raw}" escapes the bundle root`);
  }
  s = segments.filter((segment) => segment !== "").join("/");
  if (s === "") fail("BUNDLE_PATH_INVALID", `"${raw}" does not name a file`);
  return s;
}

function hasHiddenSegment(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function parseIndexMetadata(text: string, path: string): BundleIndexMetadata {
  const { front } = splitFrontmatter(text, path);
  const raw = parseFrontmatterYaml(front);
  const known = new Set(["okf_version", "title", "description", "license"]);
  const metadata: BundleIndexMetadata = {
    okf_version: optionalString(raw.okf_version, "okf_version", 40),
    title: optionalString(raw.title, "title"),
    description: optionalString(raw.description, "description"),
    license: optionalString(raw.license, "license"),
    extensions: extensionsOf(raw, known),
  };
  if (raw.okf_version !== undefined && metadata.okf_version === null) {
    fieldInvalid("okf_version", "must be a quoted string such as \"0.3\"");
  }
  return metadata;
}

function parseLog(text: string, path: string): BundleLog {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== undefined && lines[0].trim() === "---") {
    fail("LOG_FRONTMATTER", `${path}: log.md has no frontmatter in OKF v0.3`);
  }
  const dates: string[] = [];
  let entryCount = 0;
  for (const line of lines) {
    if (line.trim().startsWith("*")) entryCount += 1;
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading === null) continue;
    const value = heading[1];
    if (DATE_ONLY.test(value) === false || parseOkfTimestamp(value) === null) {
      fail("LOG_HEADING_INVALID", `${path}: "## ${value}" is not a YYYY-MM-DD date heading`);
    }
    dates.push(value);
  }
  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] >= dates[i - 1]) {
      fail("LOG_ORDER_INVALID", `${path}: log dates must be newest first (${dates[i]} follows ${dates[i - 1]})`);
    }
  }
  return { path, dates, entryCount, body: text };
}

/** Detects a supersession cycle among documents. Returns the cycle path, or null. */
export function findSupersessionCycle(
  documents: Array<{ id: string; superseded_by?: string | null }>,
): string[] | null {
  const ids = new Set(documents.map((doc) => doc.id));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const status = state.get(id);
    if (status === "visiting") {
      const at = stack.indexOf(id);
      return [...stack.slice(at), id];
    }
    if (status === "done") return null;
    state.set(id, "visiting");
    stack.push(id);
    const doc = documents.find((candidate) => candidate.id === id);
    const target = doc?.superseded_by ?? null;
    if (target !== null && ids.has(target)) {
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };

  for (const doc of documents) {
    if (state.get(doc.id) === "done") continue;
    const cycle = visit(doc.id);
    if (cycle !== null) return cycle;
  }
  return null;
}

function validateSupersession(documents: KnowledgeDocument[]): void {
  const ids = new Set(documents.map((doc) => doc.id));
  for (const doc of documents) {
    const target = doc.frontmatter.superseded_by;
    if (target === null) continue;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) continue; // external URI
    if (!ids.has(target)) {
      fail(
        "SUPERSEDED_TARGET_MISSING",
        `${doc.path}: superseded_by "${target}" does not name a concept in this bundle`,
        "superseded_by",
      );
    }
  }
  const cycle = findSupersessionCycle(
    documents.map((doc) => ({ id: doc.id, superseded_by: doc.frontmatter.superseded_by })),
  );
  if (cycle !== null) {
    fail("SUPERSEDED_CYCLE", `supersession cycle: ${cycle.join(" -> ")}`, "superseded_by");
  }
}

/**
 * Parses and validates an OKF-shaped bundle from an injected file listing (pure: the caller reads
 * the directory). Reserved `index.md` / `log.md` files are metadata, never concepts.
 */
export function parseBundle(
  files: BundleFile[] | { [path: string]: string },
  opts: { now?: NowInput } = {},
): KnowledgeBundle {
  const entries: BundleFile[] = Array.isArray(files)
    ? files
    : Object.entries(files).map(([path, text]) => ({ path, text }));

  const indexFiles: BundleFile[] = [];
  const logFiles: BundleFile[] = [];
  const conceptFiles: BundleFile[] = [];

  for (const entry of entries) {
    const path = normalizeBundlePath(entry.path);
    if (hasHiddenSegment(path)) continue; // OKF 3.2: dotfiles are not part of the bundle
    if (!path.toLowerCase().endsWith(".md")) continue; // assets
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (basename === "index.md") {
      indexFiles.push({ path, text: entry.text });
      continue;
    }
    if (basename === "log.md") {
      logFiles.push({ path, text: entry.text });
      continue;
    }
    conceptFiles.push({ path, text: entry.text });
  }

  let index: BundleIndexMetadata | null = null;
  for (const file of indexFiles) {
    if (file.path === "index.md") {
      index = file.text.split(/\r?\n/)[0]?.trim() === "---" ? parseIndexMetadata(file.text, file.path) : null;
      continue;
    }
    if (file.text.split(/\r?\n/)[0]?.trim() === "---") {
      fail("INDEX_FRONTMATTER_OUTSIDE_ROOT", `${file.path}: only the bundle-root index.md may have frontmatter`);
    }
  }

  const logs = logFiles
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => parseLog(file.text, file.path));

  const documents: KnowledgeDocument[] = [];
  const byLowerId = new Map<string, string>();
  const byId: { [id: string]: KnowledgeDocument } = {};
  for (const file of conceptFiles) {
    if (file.text.split(/\r?\n/)[0]?.trim() !== "---") continue; // not a concept (README, notes)
    const doc = parseKnowledgeDocument(file.text, { path: file.path, now: opts.now });
    const lower = doc.id.toLowerCase();
    const collision = byLowerId.get(lower);
    if (collision !== undefined) {
      fail("CONCEPT_ID_COLLISION", `${file.path} collides with ${collision} on a case-insensitive filesystem`);
    }
    byLowerId.set(lower, doc.id);
    byId[doc.id] = doc;
    documents.push(doc);
  }
  documents.sort((a, b) => a.id.localeCompare(b.id));

  validateSupersession(documents);
  return { index, logs, documents, byId };
}
