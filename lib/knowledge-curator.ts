// Curator planner: turns knowledge flags + run traces + existing knowledge docs into PROPOSED
// edits for a human review queue. Pure planning only -- this module never writes, applies, or
// persists anything. Every proposal carries `approval: "required"` and the plan reports
// `applied: false`; the approval gate lives in a later phase.
//
// Demotion rule (Dock profile of OKF v0.3): a content edit after a human review is recorded with
// a fresh `generated.at` and a machine verification event from the curator actor, so the trust
// tier lands at machine-confirmed until a human reviews the new text. Schema-level
// `computeTrustTier` still follows OKF 5.3 exactly (only current verifications count).
import { createHash } from "crypto";
import {
  canonicalSerialize,
  demoteAfterEdit,
  hashCanonical,
  parseKnowledgeDocument,
  resolveNow,
  serializeDocument,
  trustTierChange,
} from "./knowledge-schema.ts";
import type {
  KnowledgeDocument,
  KnowledgeFrontmatter,
  KnowledgeType,
  TrustTier,
} from "./knowledge-schema.ts";
import { dedupeFlags, flagId } from "./knowledge-flags.ts";
import type { KnowledgeEvidence, KnowledgeFlag, KnowledgeFlagKind } from "./knowledge-flags.ts";

export const CURATOR_ACTOR = "curator/dock-knowledge";
export const DEFAULT_MAX_PROPOSALS = 50;
export const MAX_TRACE_EVIDENCE = 20;

export interface CuratorTrace {
  id?: string;
  runId?: string;
  at?: string;
  ref?: string;
  error?: string | null;
  message?: string;
  tool?: string;
}

export interface CuratorInput {
  flags: KnowledgeFlag[];
  traces?: CuratorTrace[];
  documents?: KnowledgeDocument[];
  now?: number | string | Date;
  maxProposals?: number;
}

export type Priority = "high" | "normal" | "low";

export interface ProposalDemotion {
  from: TrustTier;
  to: TrustTier;
  reason: "edited-after-review";
  reviewRequired: true;
}

interface ProposalBase {
  id: string;
  /** Proposal action: create a new doc, or patch an existing one. */
  kind: "create" | "patch";
  /** Which knowledge-flag kind drove this proposal. */
  flagKind: KnowledgeFlagKind;
  docId: string;
  docPath: string;
  rationale: string;
  /** `flag:<id>` plus matching trace references. */
  evidenceRefs: string[];
  flagIds: string[];
  supportCount: number;
  priority: Priority;
  approval: "required";
  conflicts: string[];
}

export interface ProposedCreate extends ProposalBase {
  kind: "create";
  document: KnowledgeDocument;
  demotion: null;
}

export interface ProposedPatch extends ProposalBase {
  kind: "patch";
  before: KnowledgeDocument;
  after: KnowledgeDocument;
  section: string | null;
  changedFields: string[];
  demotion: ProposalDemotion | null;
}

export type ProposedEdit = ProposedCreate | ProposedPatch;

export interface ProposalConflict {
  type: "same_doc" | "same_section";
  docId: string;
  section: string | null;
  proposalIds: string[];
  message: string;
}

export type IgnoredFlagReason =
  | "REF_REQUIRED"
  | "EXTERNAL_REF"
  | "SUGGESTED_FIX_REQUIRED"
  | "ALREADY_EXISTS"
  | "TARGET_NOT_FOUND"
  | "DOC_SUPERSEDED"
  | "ALREADY_STALE"
  | "NO_OP"
  | "PROPOSAL_LIMIT";

export interface IgnoredFlag {
  flagId: string;
  kind: KnowledgeFlagKind;
  ref: string | null;
  reason: IgnoredFlagReason;
}

export interface ReviewDecision {
  id: string;
  proposalId: string;
  docRef: string;
  /** The human chooses approve or reject; the curator never decides. */
  action: "approve_or_reject";
  priority: Priority;
  summary: string;
  beforeTrust: TrustTier | null;
  afterTrust: TrustTier;
  demotion: boolean;
  evidenceRefs: string[];
  blockedBy: string[];
}

export interface CuratorPlan {
  proposals: ProposedEdit[];
  conflicts: ProposalConflict[];
  decisions: ReviewDecision[];
  ignoredFlags: IgnoredFlag[];
  /** Hard invariant: the planner only proposes. */
  applied: false;
  now: number;
  stats: {
    flags: number;
    traces: number;
    documents: number;
    proposals: number;
    conflicts: number;
    ignored: number;
  };
}

// ---------------------------------------------------------------------------
// Type inference (heuristic; a flag carries no type)
// ---------------------------------------------------------------------------

function evidenceText(evidence: KnowledgeEvidence | null): string {
  if (evidence === null) return "";
  if (typeof evidence === "string") return evidence;
  if (Array.isArray(evidence)) return evidence.join(" ");
  return JSON.stringify(evidence);
}

/**
 * Infers the knowledge type for a `missing` flag. Ref path wins, then evidence wording; defaults
 * to domain. Deterministic and documented as a heuristic -- a human can re-type on approval.
 */
export function inferKnowledgeType(ref: string | null, evidence: KnowledgeEvidence | null = null): KnowledgeType {
  const haystack = `${ref ?? ""} ${evidenceText(evidence)}`.toLowerCase();
  const segments = (ref ?? "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (segments.some((segment) => ["skill", "skills"].includes(segment))) return "skill";
  if (/\b(data_access|data access|data-access)\b/.test(haystack)) return "data_access";
  const dataSegments = [
    "data",
    "source",
    "sources",
    "query",
    "queries",
    "sql",
    "access",
    "api",
    "apis",
    "table",
    "tables",
    "dataset",
    "datasets",
    "endpoint",
    "endpoints",
  ];
  if (segments.some((segment) => dataSegments.includes(segment))) return "data_access";
  const domainSegments = ["domain", "domains", "policy", "policies", "fact", "facts", "definition", "definitions"];
  if (segments.some((segment) => domainSegments.includes(segment))) return "domain";
  if (/\b(how to|procedure|steps|runbook|workflow)\b/.test(haystack)) return "skill";
  if (/\b(query|endpoint|column|schema|table)\b/.test(haystack)) return "data_access";
  return "domain";
}

// ---------------------------------------------------------------------------
// Document construction helpers
// ---------------------------------------------------------------------------

function emptyFrontmatter(type: KnowledgeType): KnowledgeFrontmatter {
  return {
    type,
    title: null,
    description: null,
    resource: null,
    tags: [],
    status: "active",
    timestamp: null,
    stale_after: null,
    superseded_by: null,
    generated: null,
    verified: [],
    sources: [],
    extensions: {},
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function humanizeTitle(path: string): string {
  const base = path.split("/").pop() ?? path;
  const words = base
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (words === "") return path;
  return words[0].toUpperCase() + words.slice(1);
}

function firstSentence(text: string, max = 200): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  const match = flattened.match(/^(.+?[.!?])(\s|$)/);
  const sentence = (match?.[1] ?? flattened).trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Builds a valid parsed document through the schema's own serializer/parser. */
function materialize(
  frontmatter: KnowledgeFrontmatter,
  body: string,
  path: string,
  now: number,
): KnowledgeDocument {
  const markdown = serializeDocument({ frontmatter, body });
  return parseKnowledgeDocument(markdown, { path, now });
}

function proposalId(kind: "create" | "patch", docId: string, after: KnowledgeDocument): string {
  return `prop_${hashCanonical([kind, docId, after.contentHash])}`;
}

function decisionId(proposalId: string): string {
  return `dec_${createHash("sha256").update(proposalId, "utf8").digest("hex").slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

function traceRef(trace: CuratorTrace, index: number): string {
  if (trace.id !== undefined && trace.id !== "") return `trace:${trace.id}`;
  if (trace.runId !== undefined && trace.runId !== "") return `run:${trace.runId}`;
  return `trace#${index + 1}`;
}

function traceMatches(trace: CuratorTrace, ref: string): boolean {
  const needle = ref.toLowerCase();
  const traceRefValue = trace.ref?.toLowerCase();
  if (traceRefValue !== undefined && traceRefValue !== "") {
    if (traceRefValue === needle) return true;
    if (needle.length >= 4 && (traceRefValue.includes(needle) || needle.includes(traceRefValue))) return true;
  }
  if (needle.length < 3) return false;
  const haystack = `${trace.error ?? ""} ${trace.message ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

function collectTraceEvidence(ref: string | null, traces: CuratorTrace[]): { refs: string[]; count: number } {
  if (ref === null) return { refs: [], count: 0 };
  const refs: string[] = [];
  traces.forEach((trace, index) => {
    if (refs.length >= MAX_TRACE_EVIDENCE) return;
    if (traceMatches(trace, ref)) refs.push(traceRef(trace, index));
  });
  return { refs, count: refs.length };
}

function supportPhrase(count: number): string {
  return count === 0 ? "" : `, corroborated by ${count} run trace${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Two proposals conflict when they touch the same document (same doc id), or the same section of
 * the same document. Conflicts block the affected decisions; the planner never auto-resolves them.
 */
export function detectConflicts(proposals: ProposedEdit[]): ProposalConflict[] {
  const byDoc = new Map<string, ProposedEdit[]>();
  for (const proposal of proposals) {
    const bucket = byDoc.get(proposal.docId);
    if (bucket === undefined) byDoc.set(proposal.docId, [proposal]);
    else bucket.push(proposal);
  }

  const conflicts: ProposalConflict[] = [];
  const docIds = [...byDoc.keys()].sort();
  for (const docId of docIds) {
    const group = byDoc.get(docId)!;
    if (group.length < 2) continue;

    // Section collisions are the more specific finding; a doc-level conflict is reported when the
    // proposals aim at different targets within the document.
    const sectioned = group.filter((p): p is ProposedPatch => p.kind === "patch" && p.section !== null);
    const bySection = new Map<string, ProposedEdit[]>();
    for (const patch of sectioned) {
      const bucket = bySection.get(patch.section!);
      if (bucket === undefined) bySection.set(patch.section!, [patch]);
      else bucket.push(patch);
    }
    let sharedSection = false;
    for (const section of [...bySection.keys()].sort()) {
      const sectionGroup = bySection.get(section)!;
      if (sectionGroup.length < 2) continue;
      sharedSection = true;
      conflicts.push({
        type: "same_section",
        docId,
        section,
        proposalIds: sectionGroup.map((p) => p.id),
        message: `${sectionGroup.length} proposals touch section "${section}" of ${docId}`,
      });
    }

    const hasCreate = group.some((p) => p.kind === "create");
    const hasUnsectionedPatch = group.some((p) => p.kind === "patch" && p.section === null);
    const distinctSections = new Set(sectioned.map((p) => p.section));
    if (hasCreate || hasUnsectionedPatch || distinctSections.size > 1 || !sharedSection) {
      conflicts.push({
        type: "same_doc",
        docId,
        section: null,
        proposalIds: group.map((p) => p.id),
        message: `${group.length} proposals touch ${docId}`,
      });
    }
  }
  return conflicts.sort((a, b) =>
    a.docId !== b.docId ? a.docId.localeCompare(b.docId) : a.type.localeCompare(b.type),
  );
}

// ---------------------------------------------------------------------------
// Proposal construction
// ---------------------------------------------------------------------------

function ignore(flag: KnowledgeFlag, reason: IgnoredFlagReason): IgnoredFlag {
  return { flagId: flagId(flag), kind: flag.kind, ref: flag.ref, reason };
}

function findDocument(documents: KnowledgeDocument[], ref: string): KnowledgeDocument | undefined {
  const exact = documents.find((doc) => doc.id === ref);
  if (exact !== undefined) return exact;
  const lower = ref.toLowerCase();
  return documents.find((doc) => doc.id.toLowerCase() === lower);
}

function mergeFlagExtension(fm: KnowledgeFrontmatter, ids: string[]): { [key: string]: unknown } {
  const extensions = clone(fm.extensions);
  const existing = Array.isArray(extensions["x-flag-ids"]) ? extensions["x-flag-ids"] : [];
  const merged = new Set<string>([...existing.filter((v): v is string => typeof v === "string"), ...ids]);
  extensions["x-flag-ids"] = [...merged].sort();
  return extensions;
}

function proposeCreate(
  flag: KnowledgeFlag,
  traces: CuratorTrace[],
  now: number,
): ProposedCreate | IgnoredFlag {
  if (flag.ref === null) return ignore(flag, "REF_REQUIRED");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(flag.ref)) return ignore(flag, "EXTERNAL_REF");
  if (flag.suggestedFix === null) return ignore(flag, "SUGGESTED_FIX_REQUIRED");

  const type = inferKnowledgeType(flag.ref, flag.evidence);
  const fm = emptyFrontmatter(type);
  fm.title = humanizeTitle(flag.ref);
  if (type === "domain") fm.description = firstSentence(flag.suggestedFix);
  if (type === "data_access") fm.resource = flag.ref;
  fm.generated = { by: CURATOR_ACTOR, at: new Date(now).toISOString(), extensions: {} };
  fm.extensions = mergeFlagExtension(fm, [flagId(flag)]);
  const path = flag.ref.toLowerCase().endsWith(".md") ? flag.ref : `${flag.ref}.md`;

  const document = materialize(fm, flag.suggestedFix, path, now);
  const trace = collectTraceEvidence(flag.ref, traces);
  const priority: Priority = type === "data_access" ? "high" : "normal";
  return {
    id: proposalId("create", document.id, document),
    kind: "create",
    flagKind: "missing",
    docId: document.id,
    docPath: document.path,
    document,
    demotion: null,
    rationale:
      `Create ${type} knowledge "${document.path}" from a ${flag.kind} flag` +
      `${supportPhrase(trace.count)}. Body is the suggested fix; unverified until a human approves it.`,
    evidenceRefs: [`flag:${flagId(flag)}`, ...trace.refs],
    flagIds: [flagId(flag)],
    supportCount: trace.count,
    priority,
    approval: "required",
    conflicts: [],
  };
}

function sectionOf(body: string): string | null {
  const heading = /^#{1,6}\s+(.+?)\s*$/m.exec(body);
  return heading?.[1]?.trim() ?? null;
}

/** Explicit demotion computation for an edit: human-reviewed -> machine-confirmed until re-review. */
export function computeDemotion(
  before: KnowledgeDocument,
  after: KnowledgeDocument,
): ProposalDemotion | null {
  const change = trustTierChange(before.frontmatter, after.frontmatter);
  if (!change.demoted) return null;
  return {
    from: change.before,
    to: demoteAfterEdit(change.before, after.frontmatter),
    reason: "edited-after-review",
    reviewRequired: true,
  };
}

function changedFields(before: KnowledgeDocument, after: KnowledgeDocument): string[] {
  const fields = [
    "title",
    "description",
    "resource",
    "tags",
    "status",
    "timestamp",
    "stale_after",
    "superseded_by",
    "generated",
    "verified",
    "sources",
    "extensions",
  ] as const;
  const out: string[] = [];
  if (canonicalSerialize(before) !== canonicalSerialize(after)) {
    for (const field of fields) {
      if (JSON.stringify(before.frontmatter[field]) !== JSON.stringify(after.frontmatter[field])) out.push(field);
    }
    if (squash(before.body) !== squash(after.body) && !out.includes("body")) out.push("body");
    out.sort();
  }
  return out;
}

function proposeWrongPatch(
  flag: KnowledgeFlag,
  before: KnowledgeDocument,
  traces: CuratorTrace[],
  now: number,
): ProposedPatch | IgnoredFlag {
  if (flag.ref === null) return ignore(flag, "REF_REQUIRED");
  if (flag.suggestedFix === null) return ignore(flag, "SUGGESTED_FIX_REQUIRED");
  if (before.frontmatter.status === "superseded") return ignore(flag, "DOC_SUPERSEDED");
  if (squash(before.body) === squash(flag.suggestedFix)) return ignore(flag, "NO_OP");

  const fm = clone(before.frontmatter);
  fm.generated = { by: CURATOR_ACTOR, at: new Date(now).toISOString(), extensions: {} };
  // A machine confirmation of the edited text: the old human review no longer covers it, so the
  // tier drops to machine-confirmed until a human re-reviews. OKF 5.3 keeps older events history.
  fm.verified = [
    ...fm.verified,
    { by: CURATOR_ACTOR, at: new Date(now).toISOString(), extensions: {} },
  ];
  fm.extensions = mergeFlagExtension(fm, [flagId(flag)]);

  const after = materialize(fm, flag.suggestedFix, before.path, now);
  const demotion = computeDemotion(before, after);
  const trace = collectTraceEvidence(flag.ref, traces);
  const priority: Priority = demotion !== null || before.type === "data_access" ? "high" : "normal";
  return {
    id: proposalId("patch", before.id, after),
    kind: "patch",
    flagKind: "wrong",
    docId: before.id,
    docPath: before.path,
    before,
    after,
    section: sectionOf(flag.suggestedFix),
    changedFields: changedFields(before, after),
    demotion,
    rationale:
      `Correct "${before.path}"${demotion ? ` (trust ${demotion.from} -> ${demotion.to})` : ""}` +
      ` from a wrong flag${supportPhrase(trace.count)}. Body replaced with the suggested fix; ` +
      `human approval required before it replaces the current text.`,
    evidenceRefs: [`flag:${flagId(flag)}`, ...trace.refs],
    flagIds: [flagId(flag)],
    supportCount: trace.count,
    priority,
    approval: "required",
    conflicts: [],
  };
}

function proposeStalePatch(
  flag: KnowledgeFlag,
  before: KnowledgeDocument,
  traces: CuratorTrace[],
  now: number,
): ProposedPatch | IgnoredFlag {
  if (flag.ref === null) return ignore(flag, "REF_REQUIRED");
  if (before.frontmatter.status === "superseded") return ignore(flag, "DOC_SUPERSEDED");
  if (before.frontmatter.status === "stale") return ignore(flag, "ALREADY_STALE");

  const fm = clone(before.frontmatter);
  fm.status = "stale";
  fm.extensions = mergeFlagExtension(fm, [flagId(flag)]);
  const after = materialize(fm, before.body, before.path, now);
  const trace = collectTraceEvidence(flag.ref, traces);
  return {
    id: proposalId("patch", before.id, after),
    kind: "patch",
    flagKind: "stale",
    docId: before.id,
    docPath: before.path,
    before,
    after,
    section: null,
    changedFields: changedFields(before, after),
    demotion: null,
    rationale:
      `Mark "${before.path}" stale from a stale flag${supportPhrase(trace.count)}. ` +
      `Content is untouched; re-verification is queued for a human.`,
    evidenceRefs: [`flag:${flagId(flag)}`, ...trace.refs],
    flagIds: [flagId(flag)],
    supportCount: trace.count,
    priority: "low",
    approval: "required",
    conflicts: [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function proposeForFlag(
  flag: KnowledgeFlag,
  documents: KnowledgeDocument[],
  traces: CuratorTrace[],
  now: number,
): ProposedEdit | IgnoredFlag {
  const existing = flag.ref === null ? undefined : findDocument(documents, flag.ref);
  switch (flag.kind) {
    case "missing":
      if (flag.ref !== null && existing !== undefined) return ignore(flag, "ALREADY_EXISTS");
      return proposeCreate(flag, traces, now);
    case "wrong":
      if (flag.ref === null) return ignore(flag, "REF_REQUIRED");
      if (existing === undefined) return ignore(flag, "TARGET_NOT_FOUND");
      return proposeWrongPatch(flag, existing, traces, now);
    case "stale":
      if (flag.ref === null) return ignore(flag, "REF_REQUIRED");
      if (existing === undefined) return ignore(flag, "TARGET_NOT_FOUND");
      return proposeStalePatch(flag, existing, traces, now);
  }
}

function buildDecision(proposal: ProposedEdit, conflictIds: string[]): ReviewDecision {
  const beforeTrust = proposal.kind === "patch" ? proposal.before.trustTier : null;
  const afterTrust = proposal.kind === "patch" ? proposal.after.trustTier : proposal.document.trustTier;
  const demotion = proposal.kind === "patch" && proposal.demotion !== null;
  return {
    id: decisionId(proposal.id),
    proposalId: proposal.id,
    docRef: proposal.docPath,
    action: "approve_or_reject",
    priority: proposal.priority,
    summary: proposal.rationale,
    beforeTrust,
    afterTrust,
    demotion,
    evidenceRefs: proposal.evidenceRefs,
    blockedBy: conflictIds,
  };
}

/**
 * Pure planner. Given flags, traces, and existing documents, returns proposals, conflicts, and a
 * human review queue. Never mutates inputs and never applies anything.
 */
export function planKnowledgeEdits(input: CuratorInput): CuratorPlan {
  const now = resolveNow(input.now);
  const maxProposals = Math.max(1, input.maxProposals ?? DEFAULT_MAX_PROPOSALS);
  const flags = dedupeFlags(input.flags ?? []);
  const traces = input.traces ?? [];
  const documents = input.documents ?? [];

  const proposals: ProposedEdit[] = [];
  const ignoredFlags: IgnoredFlag[] = [];

  for (const flag of flags) {
    if (proposals.length >= maxProposals) {
      ignoredFlags.push(ignore(flag, "PROPOSAL_LIMIT"));
      continue;
    }
    const result = proposeForFlag(flag, documents, traces, now);
    if ("reason" in result) ignoredFlags.push(result);
    else proposals.push(result);
  }

  const conflicts = detectConflicts(proposals);
  const conflictByProposal = new Map<string, string[]>();
  for (const conflict of conflicts) {
    for (const id of conflict.proposalIds) {
      const bucket = conflictByProposal.get(id);
      const others = conflict.proposalIds.filter((other) => other !== id);
      if (bucket === undefined) conflictByProposal.set(id, [...others]);
      else bucket.push(...others);
    }
  }

  const annotated = proposals.map((proposal) => ({
    ...proposal,
    conflicts: conflictByProposal.get(proposal.id) ?? [],
  }));

  const decisions = annotated.map((proposal) => buildDecision(proposal, conflictByProposal.get(proposal.id) ?? []));

  return {
    proposals: annotated,
    conflicts,
    decisions,
    ignoredFlags,
    applied: false,
    now,
    stats: {
      flags: flags.length,
      traces: traces.length,
      documents: documents.length,
      proposals: annotated.length,
      conflicts: conflicts.length,
      ignored: ignoredFlags.length,
    },
  };
}
