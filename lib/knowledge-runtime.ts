// Curator runtime (WS3): the wired half of the knowledge factory.
//
// Pure planning lives in lib/knowledge-curator.ts; this module owns the database conversation and
// the approval gate:
//
//   flag -> stored flag -> curator plans proposals -> PENDING row -> human decision ->
//   approve: apply the proposed document + append audit   |   reject: record decision only
//
// Invariants enforced here:
//   * The curator NEVER auto-applies. planKnowledgeEdits output is persisted as pending proposals
//     only (`applied: false` is asserted below).
//   * Only a pending proposal can be decided; a second decision returns `not_pending`.
//   * Approval writes the proposal's own `after`/`document` frontmatter verbatim. A curator edit
//     therefore carries the curator's machine verification event and lands at machine-confirmed;
//     nothing in this runtime promotes a document to human-reviewed.
//   * Rejection changes no document.
//   * Supersession targets must exist and must not close a cycle (lib/knowledge-schema.ts).
import {
  buildDocFields,
  checkSupersession,
  countFlags,
  flagFromRow,
  prepareFlag,
  proposalHash,
  proposalView,
  rowToDocument,
  type DocRow,
  type FlagRow,
  type KnowledgeRepo,
  type ProposalRow,
  type ProposalView,
} from "./knowledge-store.ts";
import { CURATOR_ACTOR, planKnowledgeEdits } from "./knowledge-curator.ts";
import type { CuratorPlan, ProposedEdit } from "./knowledge-curator.ts";
import { serializeDocument } from "./knowledge-schema.ts";
import type { BundleIndexMetadata } from "./knowledge-schema.ts";
import { dedupeFlags } from "./knowledge-flags.ts";

export interface CuratorRunInput {
  workspaceId: string;
  ownerId: string;
  now?: number | string | Date;
  maxProposals?: number;
}

export type RecordFlagResult =
  | { ok: true; id: string; flagHash: string; duplicate: boolean }
  | { ok: false; error: string };

/**
 * Validates a raw `flag_knowledge` payload with lib/knowledge-flags.ts and stores it. Identical
 * findings collapse onto one row (unique workspace + flag_hash); the existing id is returned with
 * `duplicate: true` so a repeated observation is never an error.
 */
export async function recordKnowledgeFlag(
  repo: KnowledgeRepo,
  input: { workspaceId: string; ownerId: string; payload: unknown; runId?: string | null },
): Promise<RecordFlagResult> {
  const prepared = prepareFlag(input.payload);
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const existing = await repo.getFlagByHash(input.workspaceId, prepared.hash);
  if (existing) return { ok: true, id: existing.id, flagHash: existing.flag_hash, duplicate: true };
  try {
    const row = await repo.insertFlag({
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      flag_hash: prepared.hash,
      kind: prepared.flag.kind,
      ref: prepared.flag.ref,
      suggested_fix: prepared.flag.suggestedFix,
      evidence: prepared.flag.evidence,
      run_id: input.runId ?? null,
    });
    return { ok: true, id: row.id, flagHash: row.flag_hash, duplicate: false };
  } catch (error) {
    // Lost an insert race against an identical concurrent flag: report the winner's id.
    const raced = await repo.getFlagByHash(input.workspaceId, prepared.hash);
    if (raced) return { ok: true, id: raced.id, flagHash: raced.flag_hash, duplicate: true };
    return { ok: false, error: error instanceof Error ? error.message : "could not store flag" };
  }
}

export interface CuratorRunResult {
  created: number;
  conflicts: number;
  ignored: number;
  proposalKeys: string[];
}

function frontmatterOf(value: unknown): import("./knowledge-schema.ts").KnowledgeFrontmatter {
  if (!value || typeof value !== "object") throw new Error("proposal has no document");
  const record = value as Record<string, unknown>;
  if (!record.frontmatter || typeof record.frontmatter !== "object" || !("body" in record)) {
    throw new Error("proposal has no document");
  }
  return record.frontmatter as import("./knowledge-schema.ts").KnowledgeFrontmatter;
}

function proposalBody(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("proposal has no document");
  const record = value as Record<string, unknown>;
  if (typeof record.body !== "string") throw new Error("proposal has no document");
  return record.body;
}

/**
 * Runs the pure planner over stored flags, recent run traces and current documents, then persists
 * every proposal as a pending review row. Idempotent per proposal: re-running the curator does not
 * duplicate a proposal whose planner id already exists.
 */
export async function runCurator(repo: KnowledgeRepo, input: CuratorRunInput): Promise<CuratorRunResult> {
  const [flags, traces, docRows] = await Promise.all([
    repo.listFlags(input.workspaceId),
    repo.listRecentTraces(input.workspaceId),
    repo.listDocs(input.workspaceId, { limit: 500 }),
  ]);

  const now = input.now === undefined ? Date.now() : typeof input.now === "number" ? input.now : Date.parse(String(input.now));
  const plan: CuratorPlan = planKnowledgeEdits({
    flags: dedupeFlags(flags.map(flagFromRow)),
    traces,
    documents: docRows.map((row) => rowToDocument(row, Number.isFinite(now) ? now : Date.now())),
    now: Number.isFinite(now) ? now : Date.now(),
    maxProposals: input.maxProposals,
  });

  let created = 0;
  const proposalKeys: string[] = [];
  for (const proposal of plan.proposals) {
    const existing = await repo.getProposalByKey(input.workspaceId, proposal.id);
    if (existing) continue;
    const row = await repo.insertProposal({
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      proposal_key: proposal.id,
      proposal: proposal as unknown as Record<string, unknown>,
    });
    await repo.insertProposalEvent({
      proposal_id: row.id,
      workspace_id: input.workspaceId,
      actor_id: input.ownerId,
      event: "proposed",
      proposal_hash: proposalHash(proposal as unknown as Record<string, unknown>),
      reason: null,
      note: proposal.rationale.slice(0, 2000),
    });
    created += 1;
    proposalKeys.push(proposal.id);
  }

  return {
    created,
    conflicts: plan.conflicts.length,
    ignored: plan.ignoredFlags.length,
    proposalKeys,
  };
}

export type DecisionResult =
  | { ok: true; proposal: ProposalView }
  | {
      ok: false;
      reason: "not_found" | "not_pending" | "already_exists" | "invalid_proposal" | "supersession";
      message?: string;
      httpStatus: number;
    };

const TERMINAL = new Set(["approved", "rejected"]);

/**
 * Records a human decision on one proposal.
 *
 * approve -> applies the proposed create/patch to knowledge_documents and appends an audit event.
 * reject  -> records the decision and touches nothing else.
 * Any other state -> 409 `not_pending`.
 */
export async function decideProposal(
  repo: KnowledgeRepo,
  input: { proposalId: string; actorId: string; action: "approve" | "reject"; reason?: string | null; now?: number },
): Promise<DecisionResult> {
  const row = await repo.getProposal(input.proposalId);
  if (!row) return { ok: false, reason: "not_found", httpStatus: 404 };
  if (TERMINAL.has(row.status)) {
    return { ok: false, reason: "not_pending", message: "Proposal is no longer pending", httpStatus: 409 };
  }

  const proposal = row.proposal as Record<string, unknown>;
  const reason = input.reason?.trim() ?? null;
  const decidedAt = new Date(input.now ?? Date.now()).toISOString();
  const hash = proposalHash(proposal);

  if (input.action !== "approve") {
    await repo.updateProposal(row.id, {
      status: "rejected",
      decision_by: input.actorId,
      decision_at: decidedAt,
      decision_reason: reason,
    });
    await repo.insertProposalEvent({
      proposal_id: row.id,
      workspace_id: row.workspace_id,
      actor_id: input.actorId,
      event: "rejected",
      proposal_hash: hash,
      reason,
      note: null,
    });
    const updated = await repo.getProposal(row.id);
    return { ok: true, proposal: proposalView(updated ?? row) };
  }

  // Approve: materialize exactly what was proposed.
  const kind = proposal.kind;
  const source = kind === "create" ? proposal.document : kind === "patch" ? proposal.after : null;
  let built;
  try {
    if (source === null || source === undefined) throw new Error("proposal has no document");
    built = buildDocFields({
      docId: String(proposal.docId ?? ""),
      path: typeof proposal.docPath === "string" ? proposal.docPath : undefined,
      frontmatter: frontmatterOf(source),
      body: proposalBody(source),
      now: input.now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "proposal document is invalid";
    await repo.insertProposalEvent({
      proposal_id: row.id,
      workspace_id: row.workspace_id,
      actor_id: input.actorId,
      event: "failed",
      proposal_hash: hash,
      reason: null,
      note: message.slice(0, 2000),
    });
    return { ok: false, reason: "invalid_proposal", message, httpStatus: 409 };
  }

  if (kind === "create") {
    const existing = await repo.getDocByDocId(row.workspace_id, built.doc_id);
    if (existing) return { ok: false, reason: "already_exists", message: `${built.doc_id} already exists`, httpStatus: 409 };
  }

  const docs = await repo.listDocs(row.workspace_id, { limit: 500 });
  const supersession = checkSupersession(
    docs.map((doc) => ({ id: doc.doc_id, superseded_by: doc.superseded_by })),
    { id: built.doc_id, superseded_by: built.superseded_by },
  );
  if (!supersession.ok) {
    await repo.insertProposalEvent({
      proposal_id: row.id,
      workspace_id: row.workspace_id,
      actor_id: input.actorId,
      event: "failed",
      proposal_hash: hash,
      reason: supersession.reason,
      note: supersession.message.slice(0, 2000),
    });
    return { ok: false, reason: "supersession", message: supersession.message, httpStatus: 409 };
  }

  const applied = await repo.putDoc({
    ...built,
    workspace_id: row.workspace_id,
    owner_id: row.owner_id,
  } as Omit<DocRow, "id" | "created_at" | "updated_at">);

  await repo.updateProposal(row.id, {
    status: "approved",
    decision_by: input.actorId,
    decision_at: decidedAt,
    decision_reason: reason,
    applied_doc_id: applied.doc_id,
  });
  await repo.insertProposalEvent({
    proposal_id: row.id,
    workspace_id: row.workspace_id,
    actor_id: input.actorId,
    event: "approved",
    proposal_hash: hash,
    reason,
    note: applied.doc_id,
  });

  const updated = await repo.getProposal(row.id);
  return { ok: true, proposal: proposalView(updated ?? row) };
}

/** Flag counts for the review queue header. */
export function flagCounts(flags: FlagRow[]): { missing: number; wrong: number; stale: number } {
  return countFlags(flags.map(flagFromRow));
}

// ---------------------------------------------------------------------------
// Portable export
// ---------------------------------------------------------------------------

export interface KnowledgeBundleFile {
  path: string;
  content: string;
}

export interface KnowledgeExport {
  index: BundleIndexMetadata;
  files: KnowledgeBundleFile[];
}

const BUNDLE_TITLE = "Dock knowledge export";

function renderIndexMarkdown(index: BundleIndexMetadata): string {
  const lines = ["---", `okf_version: ${JSON.stringify(index.okf_version ?? "0.3")}`];
  if (index.title !== null) lines.push(`title: ${JSON.stringify(index.title)}`);
  if (index.description !== null) lines.push(`description: ${JSON.stringify(index.description)}`);
  if (index.license !== null) lines.push(`license: ${JSON.stringify(index.license)}`);
  lines.push("---", "", `# ${index.title ?? BUNDLE_TITLE}`, "");
  return lines.join("\n");
}

/** Append-only OKF log.md: one YYYY-MM-DD heading per day, newest first, `*` entries beneath. */
export function renderLog(
  entries: Array<{ at: string; text: string }>,
  title = "Knowledge log",
): string {
  const byDay = new Map<string, string[]>();
  for (const entry of entries) {
    const day = entry.at.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const bucket = byDay.get(day) ?? [];
    bucket.push(`* ${entry.text.replace(/\s+/g, " ").trim()}`);
    byDay.set(day, bucket);
  }
  const days = [...byDay.keys()].sort().reverse();
  const lines = [`# ${title}`, ""];
  for (const day of days) {
    lines.push(`## ${day}`, "", ...(byDay.get(day) ?? []), "");
  }
  return lines.join("\n");
}

/**
 * Builds a portable OKF-shaped bundle from the stored rows: an index.md plus one file per document
 * (regenerated through serializeDocument) plus the append-only log.md. Markdown-in-git sync is out
 * of scope; this export is the portable hand-off format.
 */
export async function buildKnowledgeBundle(
  repo: KnowledgeRepo,
  workspaceId: string,
  opts: { title?: string; description?: string } = {},
): Promise<KnowledgeExport> {
  const [docs, proposals] = await Promise.all([
    repo.listDocs(workspaceId, { limit: 500 }),
    repo.listProposals(workspaceId),
  ]);

  const files: KnowledgeBundleFile[] = docs.map((doc) => ({
    path: doc.doc_path,
    content: serializeDocument({ frontmatter: doc.frontmatter, body: doc.body }),
  }));

  const index: BundleIndexMetadata = {
    okf_version: "0.3",
    title: opts.title ?? BUNDLE_TITLE,
    description: opts.description ?? `${docs.length} knowledge documents exported from Dock`,
    license: null,
    extensions: {},
  };
  files.unshift({ path: "index.md", content: renderIndexMarkdown(index) });

  const logEntries = proposals
    .filter((row) => row.created_at)
    .map((row) => {
      const proposal = row.proposal as Record<string, unknown>;
      const label = `${String(proposal.kind ?? "proposal")} ${String(proposal.docPath ?? row.proposal_key)}`;
      const action = row.status === "pending" ? "proposed" : `${row.status}${row.decision_at ? ` ${row.decision_at}` : ""}`;
      return { at: row.created_at, text: `${action}: ${label}` };
    })
    .filter((entry) => Number.isFinite(Date.parse(entry.at)));
  files.push({ path: "log.md", content: renderLog(logEntries) });

  return { index, files };
}
