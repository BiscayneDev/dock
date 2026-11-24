// Knowledge store (WS3): the data layer behind /api/knowledge.
//
// Two layers, mirroring lib/memory-core.ts + lib/memory.ts:
//   * Pure row mapping and validation (buildDocFields, documentView, flagView, proposalView,
//     supersession checks). No I/O, no framework imports -- node --test loads this file directly.
//   * A narrow KnowledgeRepo interface plus a Supabase adapter. Route handlers and the worker tool
//     depend on the interface, so the runtime logic is testable against an in-memory fake.
//
// Every canonical value (contentHash, trustTier, freshness, portable markdown) is computed by
// lib/knowledge-schema.ts. Clients never supply them.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFreshness,
  computeTrustTier,
  findSupersessionCycle,
  hashCanonical,
  normalizeKnowledgePath,
  parseKnowledgeDocument,
  serializeDocument,
} from "./knowledge-schema.ts";
import type {
  Freshness,
  KnowledgeDocument,
  KnowledgeFrontmatter,
  KnowledgeSource,
  KnowledgeStatus,
  KnowledgeType,
  TrustTier,
} from "./knowledge-schema.ts";
import { flagId, parseKnowledgeFlag } from "./knowledge-flags.ts";
import type { KnowledgeEvidence, KnowledgeFlag } from "./knowledge-flags.ts";

// ---------------------------------------------------------------------------
// Row shapes (one per table in db/migrations/0013_knowledge.sql)
// ---------------------------------------------------------------------------

export interface DocRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  doc_id: string;
  doc_path: string;
  type: KnowledgeType;
  title: string | null;
  description: string | null;
  resource: string | null;
  status: KnowledgeStatus;
  trust_tier: TrustTier;
  freshness: Freshness;
  tags: string[];
  sources: KnowledgeSource[];
  stale_after: string | null;
  superseded_by: string | null;
  content_hash: string;
  /** Markdown body only (no frontmatter); the OKF document is regenerated on read. */
  body: string;
  frontmatter: KnowledgeFrontmatter;
  created_at: string;
  updated_at: string;
}

export interface FlagRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  flag_hash: string;
  kind: KnowledgeFlag["kind"];
  ref: string | null;
  suggested_fix: string | null;
  evidence: KnowledgeEvidence | null;
  run_id: string | null;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  proposal_key: string;
  proposal: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  applied_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalEventRow {
  proposal_id: string;
  workspace_id: string;
  actor_id: string | null;
  event: "proposed" | "approved" | "rejected" | "failed";
  proposal_hash: string;
  reason: string | null;
  note: string | null;
}

/** Fields a caller supplies when creating a proposal; decision state starts null/pending. */
export type NewProposal = Omit<
  ProposalRow,
  "id" | "created_at" | "updated_at" | "status" | "decision_by" | "decision_at" | "decision_reason" | "applied_doc_id"
> & { status?: ProposalRow["status"] };

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

export interface BuildDocInput {
  /** Normalized concept id. Derived from `path` when omitted. */
  docId?: string;
  /** Bundle path (`type/title.md`). Derived from `docId` when omitted. */
  path?: string;
  frontmatter: KnowledgeFrontmatter;
  body: string;
  now?: number;
}

export interface BuiltDoc {
  doc_id: string;
  doc_path: string;
  type: KnowledgeType;
  title: string | null;
  description: string | null;
  resource: string | null;
  status: KnowledgeStatus;
  trust_tier: TrustTier;
  freshness: Freshness;
  tags: string[];
  sources: KnowledgeSource[];
  stale_after: string | null;
  superseded_by: string | null;
  content_hash: string;
  body: string;
  frontmatter: KnowledgeFrontmatter;
}

function isExternalRef(ref: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref);
}

/**
 * Validates and materializes one document through the schema module: serializes to OKF markdown,
 * re-parses it, and reads back the canonical hash/tier/freshness. Throws KnowledgeSchemaError on
 * invalid input, so a bad write fails at the store boundary rather than silently landing.
 */
export function buildDocFields(input: BuildDocInput): BuiltDoc {
  const derived = normalizeKnowledgePath(input.docId ?? input.path ?? "");
  if (derived === "") throw new Error("knowledge document requires a docId or path");
  const docId = derived;
  const docPath = input.path ?? (isExternalRef(docId) ? docId : `${docId}.md`);
  const markdown = serializeDocument({ frontmatter: input.frontmatter, body: input.body });
  const parsed = parseKnowledgeDocument(markdown, { path: docPath, now: input.now });
  return {
    doc_id: parsed.id,
    doc_path: parsed.path,
    type: parsed.type,
    title: parsed.frontmatter.title,
    description: parsed.frontmatter.description,
    resource: parsed.frontmatter.resource,
    status: parsed.frontmatter.status,
    trust_tier: parsed.trustTier,
    freshness: parsed.freshness,
    tags: parsed.frontmatter.tags,
    sources: parsed.frontmatter.sources,
    stale_after: parsed.frontmatter.stale_after,
    superseded_by: parsed.frontmatter.superseded_by,
    content_hash: parsed.contentHash,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
  };
}

/** Re-parses a stored row into the schema's document model (trust/freshness stay recomputable). */
export function rowToDocument(row: DocRow, now: number = Date.now()): KnowledgeDocument {
  return parseKnowledgeDocument(serializeDocument({ frontmatter: row.frontmatter, body: row.body }), {
    path: row.doc_path,
    now,
  });
}

export interface DocumentView {
  id: string;
  docId: string;
  type: KnowledgeType;
  title: string | null;
  description: string | null;
  status: KnowledgeStatus;
  trustTier: TrustTier;
  freshness: Freshness;
  tags: string[];
  sources: KnowledgeSource[];
  staleAfter: string | null;
  supersededBy: string | null;
  contentHash: string;
  /** Portable OKF markdown, regenerated from the stored row via serializeDocument. */
  body: string;
  updatedAt: string;
}

export function documentView(row: DocRow): DocumentView {
  return {
    id: row.id,
    docId: row.doc_id,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    trustTier: row.trust_tier,
    freshness: row.freshness,
    tags: row.tags,
    sources: row.sources,
    staleAfter: row.stale_after,
    supersededBy: row.superseded_by,
    contentHash: row.content_hash,
    body: serializeDocument({ frontmatter: row.frontmatter, body: row.body }),
    updatedAt: row.updated_at,
  };
}

export interface FlagView {
  id: string;
  kind: KnowledgeFlag["kind"];
  ref: string | null;
  suggestedFix: string | null;
  evidence: KnowledgeEvidence | null;
  runId: string | null;
  flagHash: string;
  createdAt: string;
}

export function flagView(row: FlagRow): FlagView {
  return {
    id: row.id,
    kind: row.kind,
    ref: row.ref,
    suggestedFix: row.suggested_fix,
    evidence: row.evidence,
    runId: row.run_id,
    flagHash: row.flag_hash,
    createdAt: row.created_at,
  };
}

export function flagFromRow(row: FlagRow): KnowledgeFlag {
  return {
    kind: row.kind,
    ref: row.ref,
    suggestedFix: row.suggested_fix,
    evidence: row.evidence,
  };
}

export interface ProposalView {
  id: string;
  /** Stable planner id (`prop_...`), kept separately so the row id stays the primary key. */
  plannerId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
  decisionBy: string | null;
  decisionAt: string | null;
  decisionReason: string | null;
  appliedDocId: string | null;
  [key: string]: unknown;
}

export function proposalView(row: ProposalRow): ProposalView {
  const proposal = row.proposal ?? {};
  const view: ProposalView = {
    ...proposal,
    plannerId: typeof proposal.id === "string" ? proposal.id : row.proposal_key,
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decisionBy: row.decision_by,
    decisionAt: row.decision_at,
    decisionReason: row.decision_reason,
    appliedDocId: row.applied_doc_id,
  };
  return view;
}

export interface FlagCounts {
  missing: number;
  wrong: number;
  stale: number;
}

export function countFlags(flags: KnowledgeFlag[]): FlagCounts {
  const counts: FlagCounts = { missing: 0, wrong: 0, stale: 0 };
  for (const flag of flags) counts[flag.kind] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export type FlagResult = { ok: true; id: string; flagHash: string } | { ok: false; error: string };

/**
 * Validates a raw flag payload with the pure parser and returns the stable flag hash. Shared by the
 * HTTP callback and the worker tool so both paths normalize identically.
 */
export function prepareFlag(payload: unknown): { ok: true; flag: KnowledgeFlag; hash: string } | { ok: false; error: string } {
  try {
    const flag = parseKnowledgeFlag(payload);
    return { ok: true, flag, hash: flagId(flag) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid flag";
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

export type SupersessionCheck =
  | { ok: true }
  | { ok: false; reason: "target_missing" | "cycle"; message: string };

/**
 * Applying a create/patch that names a replacement must not dangle and must not close a cycle.
 * External URI targets are allowed (the bundle validator skips them too).
 */
export function checkSupersession(
  documents: Array<{ id: string; superseded_by?: string | null }>,
  candidate: { id: string; superseded_by?: string | null },
): SupersessionCheck {
  const target = candidate.superseded_by ?? null;
  if (target !== null && !isExternalRef(target)) {
    const exists = documents.some((doc) => doc.id === target) || target === candidate.id;
    if (!exists) {
      return { ok: false, reason: "target_missing", message: `superseded_by "${target}" does not exist` };
    }
  }
  const merged = [...documents.filter((doc) => doc.id !== candidate.id), candidate];
  const cycle = findSupersessionCycle(merged.map((doc) => ({ id: doc.id, superseded_by: doc.superseded_by })));
  if (cycle !== null) {
    return { ok: false, reason: "cycle", message: `supersession cycle: ${cycle.join(" -> ")}` };
  }
  return { ok: true };
}

export function proposalHash(proposal: Record<string, unknown>): string {
  return hashCanonical(proposal);
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface ListDocFilters {
  type?: string;
  status?: string;
  /** Case-insensitive match over doc id, path, title, description and body. */
  q?: string;
  limit?: number;
}

export interface KnowledgeRepo {
  listDocs(workspaceId: string, filters?: ListDocFilters): Promise<DocRow[]>;
  getDocByDocId(workspaceId: string, docId: string): Promise<DocRow | null>;
  putDoc(row: Omit<DocRow, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<DocRow>;
  listFlags(workspaceId: string): Promise<FlagRow[]>;
  getFlagByHash(workspaceId: string, flagHash: string): Promise<FlagRow | null>;
  insertFlag(row: Omit<FlagRow, "id" | "created_at">): Promise<FlagRow>;
  listProposals(workspaceId: string): Promise<ProposalRow[]>;
  getProposal(id: string): Promise<ProposalRow | null>;
  getProposalByKey(workspaceId: string, key: string): Promise<ProposalRow | null>;
  insertProposal(row: NewProposal): Promise<ProposalRow>;
  updateProposal(
    id: string,
    patch: Partial<Pick<ProposalRow, "status" | "decision_by" | "decision_at" | "decision_reason" | "applied_doc_id">>,
  ): Promise<void>;
  insertProposalEvent(row: Omit<ProposalEventRow, "id" | "created_at">): Promise<void>;
  /** Recent task-run event traces for the curator (newest first). */
  listRecentTraces(workspaceId: string, limit?: number): Promise<import("./knowledge-curator.ts").CuratorTrace[]>;
}

// ---------------------------------------------------------------------------
// Supabase adapter
// ---------------------------------------------------------------------------

const DOC_COLUMNS = [
  "id",
  "workspace_id",
  "owner_id",
  "doc_id",
  "doc_path",
  "type",
  "title",
  "description",
  "resource",
  "status",
  "trust_tier",
  "freshness",
  "tags",
  "sources",
  "stale_after",
  "superseded_by",
  "content_hash",
  "body",
  "frontmatter",
  "created_at",
  "updated_at",
].join(", ");

function docRow(raw: Record<string, unknown>): DocRow {
  return {
    id: raw.id as string,
    workspace_id: raw.workspace_id as string,
    owner_id: raw.owner_id as string,
    doc_id: raw.doc_id as string,
    doc_path: raw.doc_path as string,
    type: raw.type as KnowledgeType,
    title: (raw.title as string | null) ?? null,
    description: (raw.description as string | null) ?? null,
    resource: (raw.resource as string | null) ?? null,
    status: raw.status as KnowledgeStatus,
    trust_tier: raw.trust_tier as TrustTier,
    freshness: raw.freshness as Freshness,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    sources: Array.isArray(raw.sources) ? (raw.sources as KnowledgeSource[]) : [],
    stale_after: (raw.stale_after as string | null) ?? null,
    superseded_by: (raw.superseded_by as string | null) ?? null,
    content_hash: raw.content_hash as string,
    body: raw.body as string,
    frontmatter: (raw.frontmatter ?? {}) as KnowledgeFrontmatter,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

function flagRow(raw: Record<string, unknown>): FlagRow {
  return {
    id: raw.id as string,
    workspace_id: raw.workspace_id as string,
    owner_id: raw.owner_id as string,
    flag_hash: raw.flag_hash as string,
    kind: raw.kind as KnowledgeFlag["kind"],
    ref: (raw.ref as string | null) ?? null,
    suggested_fix: (raw.suggested_fix as string | null) ?? null,
    evidence: (raw.evidence as KnowledgeEvidence | null) ?? null,
    run_id: (raw.run_id as string | null) ?? null,
    created_at: raw.created_at as string,
  };
}

function proposalRow(raw: Record<string, unknown>): ProposalRow {
  return {
    id: raw.id as string,
    workspace_id: raw.workspace_id as string,
    owner_id: raw.owner_id as string,
    proposal_key: raw.proposal_key as string,
    proposal: (raw.proposal ?? {}) as Record<string, unknown>,
    status: raw.status as ProposalRow["status"],
    decision_by: (raw.decision_by as string | null) ?? null,
    decision_at: (raw.decision_at as string | null) ?? null,
    decision_reason: (raw.decision_reason as string | null) ?? null,
    applied_doc_id: (raw.applied_doc_id as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

function toDocInsert(doc: BuiltDoc, workspaceId: string, ownerId: string): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    owner_id: ownerId,
    doc_id: doc.doc_id,
    doc_path: doc.doc_path,
    type: doc.type,
    title: doc.title,
    description: doc.description,
    resource: doc.resource,
    status: doc.status,
    trust_tier: doc.trust_tier,
    freshness: doc.freshness,
    tags: doc.tags,
    sources: doc.sources,
    stale_after: doc.stale_after,
    superseded_by: doc.superseded_by,
    content_hash: doc.content_hash,
    body: doc.body,
    frontmatter: doc.frontmatter,
  };
}

/** Supabase-backed repository. Callers pass the session client (RLS applies) or the service role. */
export function supabaseKnowledgeRepo(client: SupabaseClient): KnowledgeRepo {
  return {
    async listDocs(workspaceId, filters = {}) {
      let query = client
        .from("knowledge_documents")
        .select(DOC_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(Math.min(filters.limit ?? 200, 500));
      if (filters.type) query = query.eq("type", filters.type);
      if (filters.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw new Error(`knowledge_documents: ${error.message}`);
      const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(docRow);
      const q = filters.q?.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter((row) =>
        [row.doc_id, row.doc_path, row.title ?? "", row.description ?? "", row.body]
          .join("\n")
          .toLowerCase()
          .includes(q),
      );
    },

    async getDocByDocId(workspaceId, docId) {
      const { data, error } = await client
        .from("knowledge_documents")
        .select(DOC_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("doc_id", docId)
        .maybeSingle();
      if (error) throw new Error(`knowledge_documents: ${error.message}`);
      return data ? docRow(data as unknown as Record<string, unknown>) : null;
    },

    async putDoc(row) {
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = { ...toDocInsert(row as BuiltDoc, row.workspace_id, row.owner_id), updated_at: now };
      if (row.id) payload.id = row.id;
      const { data, error } = await client
        .from("knowledge_documents")
        .upsert(payload, { onConflict: "workspace_id,doc_id" })
        .select(DOC_COLUMNS)
        .single();
      if (error) throw new Error(`knowledge_documents: ${error.message}`);
      return docRow(data as unknown as Record<string, unknown>);
    },

    async listFlags(workspaceId) {
      const { data, error } = await client
        .from("knowledge_flags")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(`knowledge_flags: ${error.message}`);
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(flagRow);
    },

    async getFlagByHash(workspaceId, flagHash) {
      const { data, error } = await client
        .from("knowledge_flags")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("flag_hash", flagHash)
        .maybeSingle();
      if (error) throw new Error(`knowledge_flags: ${error.message}`);
      return data ? flagRow(data as unknown as Record<string, unknown>) : null;
    },

    async insertFlag(row) {
      const { data, error } = await client
        .from("knowledge_flags")
        .insert({
          workspace_id: row.workspace_id,
          owner_id: row.owner_id,
          flag_hash: row.flag_hash,
          kind: row.kind,
          ref: row.ref,
          suggested_fix: row.suggested_fix,
          evidence: row.evidence,
          run_id: row.run_id,
        })
        .select("*")
        .single();
      if (error) throw new Error(`knowledge_flags: ${error.message}`);
      return flagRow(data as unknown as Record<string, unknown>);
    },

    async listProposals(workspaceId) {
      const { data, error } = await client
        .from("knowledge_proposals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(`knowledge_proposals: ${error.message}`);
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(proposalRow);
    },

    async getProposal(id) {
      const { data, error } = await client.from("knowledge_proposals").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`knowledge_proposals: ${error.message}`);
      return data ? proposalRow(data as unknown as Record<string, unknown>) : null;
    },

    async getProposalByKey(workspaceId, key) {
      const { data, error } = await client
        .from("knowledge_proposals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("proposal_key", key)
        .maybeSingle();
      if (error) throw new Error(`knowledge_proposals: ${error.message}`);
      return data ? proposalRow(data as unknown as Record<string, unknown>) : null;
    },

    async insertProposal(row) {
      const { data, error } = await client
        .from("knowledge_proposals")
        .insert({
          workspace_id: row.workspace_id,
          owner_id: row.owner_id,
          proposal_key: row.proposal_key,
          proposal: row.proposal,
          status: "pending",
        })
        .select("*")
        .single();
      if (error) throw new Error(`knowledge_proposals: ${error.message}`);
      return proposalRow(data as unknown as Record<string, unknown>);
    },

    async updateProposal(id, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.decision_by !== undefined) row.decision_by = patch.decision_by;
      if (patch.decision_at !== undefined) row.decision_at = patch.decision_at;
      if (patch.decision_reason !== undefined) row.decision_reason = patch.decision_reason;
      if (patch.applied_doc_id !== undefined) row.applied_doc_id = patch.applied_doc_id;
      const { error } = await client.from("knowledge_proposals").update(row).eq("id", id);
      if (error) throw new Error(`knowledge_proposals: ${error.message}`);
    },

    async insertProposalEvent(row) {
      const { error } = await client.from("knowledge_proposal_events").insert({
        proposal_id: row.proposal_id,
        workspace_id: row.workspace_id,
        actor_id: row.actor_id,
        event: row.event,
        proposal_hash: row.proposal_hash,
        reason: row.reason,
        note: row.note,
      });
      if (error) throw new Error(`knowledge_proposal_events: ${error.message}`);
    },

    async listRecentTraces(workspaceId, limit = 200) {
      const { data: runs, error: runsError } = await client
        .from("task_runs")
        .select("id")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (runsError) throw new Error(`task_runs: ${runsError.message}`);
      const runIds = ((runs ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (runIds.length === 0) return [];
      const { data: events, error: eventsError } = await client
        .from("task_run_events")
        .select("id, run_id, kind, data, created_at")
        .in("run_id", runIds)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (eventsError) throw new Error(`task_run_events: ${eventsError.message}`);
      return ((events ?? []) as Array<Record<string, unknown>>).map((event) => {
        const data = (event.data ?? {}) as Record<string, unknown>;
        return {
          id: event.id as string,
          runId: event.run_id as string,
          at: event.created_at as string,
          ref: typeof data.ref === "string" ? data.ref : undefined,
          error: typeof data.error === "string" ? data.error : null,
          message: typeof data.message === "string" ? data.message : typeof data.output === "string" ? data.output.slice(0, 400) : undefined,
          tool: typeof data.tool === "string" ? data.tool : (event.kind as string),
        };
      });
    },
  };
}

export { computeTrustTier, computeFreshness };
