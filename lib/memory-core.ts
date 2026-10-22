// Shipyard Memory core for Dock: pure logic over an injected repository and embedder.
// No framework or Supabase imports here, so node:test can run it against an in-memory repo.
// lib/memory.ts wires this to Dock's Supabase (memory_items, migration 0009) and the Shipyard Memory package.

export type MemoryScope = "conversation" | "fact" | "project";
export type MemoryType = "conversation" | "fact" | "person" | "preference" | "org" | "event";

export interface MemoryRow {
  id: string;
  ownerId: string;
  workspaceId: string;
  projectId: string | null;
  projectName?: string | null;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  conversationId: string | null;
  embeddingModel: string | null;
  createdAt: string;
}

export interface NewMemoryRow {
  ownerId: string;
  workspaceId: string;
  projectId: string | null;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  conversationId: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
}

export interface VectorHit {
  row: MemoryRow;
  similarity: number;
}

export interface MemoryRepo {
  insert(row: NewMemoryRow): Promise<MemoryRow>;
  /** Owner-filtered, newest first. Never returns another owner's rows. */
  listRecent(ownerId: string, limit: number): Promise<MemoryRow[]>;
  /** Owner-filtered hard delete. Returns true when a row was removed. */
  delete(ownerId: string, id: string): Promise<boolean>;
  /** Optional vector search, owner- and project-filtered in the database. */
  vectorMatch?(args: {
    ownerId: string;
    projectId: string | null;
    model: string;
    embedding: number[];
    limit: number;
  }): Promise<VectorHit[]>;
}

export interface MemoryDeps {
  repo: MemoryRepo;
  /** Returns null when no embedding provider is configured; recall then uses keywords. */
  embed: (text: string) => Promise<number[] | null>;
  embeddingModel: string;
  /** One-shot completion for fact extraction. Returns the assistant text. */
  complete?: (system: string, user: string) => Promise<string>;
  onError?: (msg: string, err: unknown) => void;
}

export interface RecallHit {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  projectId: string | null;
  projectName: string | null;
  score: number;
  via: "vector" | "keyword" | "recent";
}

export const MAX_CONTENT = 4000;
const FACT_TYPES = new Set<MemoryType>(["fact", "person", "preference", "org", "event"]);
const MAX_CANDIDATES = 300;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that", "this", "from", "have",
  "what", "when", "where", "which", "who", "how", "can", "could", "would", "should", "about", "just",
  "into", "than", "then", "there", "their", "them", "they", "was", "were", "will", "its", "our", "out",
]);

/** Lowercased word tokens of length >= 3, stopwords removed. */
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return [...out];
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

/** Scope/project rule: project knowledge must name a project; facts and conversation turns may not need one. */
export function validateScope(scope: MemoryScope, projectId: string | null): void {
  if (scope !== "conversation" && scope !== "fact" && scope !== "project") throw new Error(`invalid scope: ${scope}`);
  if (scope === "project" && !projectId) throw new Error("project scope requires a projectId");
}

/**
 * Store one memory item for an owner. Embeds when a provider is configured; otherwise the row is
 * stored without a vector (keyword-searchable). Throws on invalid input; callers in chat fail open.
 */
export async function remember(
  deps: MemoryDeps,
  input: {
    scope: MemoryScope;
    ownerId: string;
    workspaceId: string;
    projectId: string | null;
    content: string;
    type?: MemoryType;
    conversationId?: string | null;
  },
): Promise<MemoryRow> {
  validateScope(input.scope, input.projectId);
  const content = normalizeContent(input.content).slice(0, MAX_CONTENT);
  if (!content) throw new Error("memory content is empty");
  const type: MemoryType = input.type ?? (input.scope === "conversation" ? "conversation" : "fact");
  let embedding: number[] | null = null;
  try {
    embedding = await deps.embed(content);
  } catch (err) {
    deps.onError?.("embed failed; storing keyword-only", err);
  }
  return deps.repo.insert({
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    scope: input.scope,
    type,
    content,
    conversationId: input.conversationId ?? null,
    embedding,
    embeddingModel: embedding ? deps.embeddingModel : null,
  });
}

/** Keyword score: distinct query tokens found in the content (case-insensitive). */
function keywordScore(queryTokens: string[], content: string): number {
  const haystack = content.toLowerCase();
  let hits = 0;
  for (const t of queryTokens) if (haystack.includes(t)) hits += 1;
  return hits;
}

/** A row is visible to a chat in projectId when it is owner-wide or belongs to that project. */
export function visibleTo(row: MemoryRow, projectId: string | null): boolean {
  return row.projectId === null || row.projectId === projectId;
}

/**
 * Recall for one owner in one project context. Owner-wide items (projectId null) and items of
 * `projectId` only; another project's knowledge never appears. Vector search when an embedding
 * exists and the repo supports it; otherwise keyword ranking over the owner's recent items.
 * With an empty query, returns the newest items.
 */
export async function recall(
  deps: MemoryDeps,
  input: { ownerId: string; query: string; projectId: string | null; limit?: number },
): Promise<RecallHit[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 8, 50));
  const query = normalizeContent(input.query);

  if (query && deps.repo.vectorMatch) {
    try {
      const embedding = await deps.embed(query);
      if (embedding) {
        const hits = await deps.repo.vectorMatch({
          ownerId: input.ownerId,
          projectId: input.projectId,
          model: deps.embeddingModel,
          embedding,
          limit,
        });
        return hits
          .filter((h) => visibleTo(h.row, input.projectId))
          .map((h) => toHit(h.row, h.similarity, "vector"));
      }
    } catch (err) {
      deps.onError?.("vector recall failed; using keywords", err);
    }
  }

  const rows = (await deps.repo.listRecent(input.ownerId, MAX_CANDIDATES)).filter((r) => r.ownerId === input.ownerId);
  const visible = rows.filter((r) => visibleTo(r, input.projectId));
  const qt = tokens(query);
  if (!query || qt.length === 0) {
    return visible.slice(0, limit).map((r) => toHit(r, 0, "recent"));
  }
  return visible
    .map((r) => ({ row: r, score: keywordScore(qt, r.content) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.row.createdAt < b.row.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((x) => toHit(x.row, x.score, "keyword"));
}

function toHit(row: MemoryRow, score: number, via: RecallHit["via"]): RecallHit {
  return {
    id: row.id,
    scope: row.scope,
    type: row.type,
    content: row.content,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    score,
    via,
  };
}

/** Owner-only delete. Returns false for other owners' ids and unknown ids. */
export async function forget(deps: MemoryDeps, ownerId: string, id: string): Promise<boolean> {
  return deps.repo.delete(ownerId, id);
}

/**
 * The "What you remember" block for the Chief's prompt: durable facts plus this project's knowledge.
 * Returns null when there is nothing to show. Conversation turns are never placed in the prompt.
 */
export function memoryPromptBlock(hits: RecallHit[], projectId: string | null): string | null {
  const items = hits.filter((h) => h.scope === "fact" || (h.scope === "project" && h.projectId === projectId));
  if (items.length === 0) return null;
  const lines = items.slice(0, 6).map((h) => {
    const text = h.content.length > 300 ? `${h.content.slice(0, 297)}...` : h.content;
    return h.scope === "project" ? `- (project) ${text}` : `- ${text}`;
  });
  return [
    "What you remember (background from earlier chats; verify before relying on it, and rules above override it):",
    ...lines,
  ].join("\n");
}

const EXTRACTION_SYSTEM = `Extract durable facts worth remembering about the user from this chat turn. Respond with ONLY valid JSON: {"facts": [{"content": "...", "type": "fact|person|preference|org|event", "scope": "fact|project"}]}
rules:
- only concrete, reusable facts (decisions, preferences, people, plans, ongoing situations)
- scope "project" only for facts about the current project; otherwise "fact"
- include the date when a fact is time-bound
- no transient chatter, no questions, no filler, no secrets (keys, passwords, card numbers)
- max 5 facts; omit facts already listed as existing memories`;

/**
 * Run durable-fact extraction over one finished chat turn and store the results.
 * Never throws: every failure is reported through onError and skipped.
 */
export async function extractFacts(
  deps: MemoryDeps,
  input: {
    ownerId: string;
    workspaceId: string;
    projectId: string | null;
    conversationId: string | null;
    userText: string;
    assistantText: string;
  },
): Promise<number> {
  try {
    if (!deps.complete) return 0;
    const existing = (await deps.repo.listRecent(input.ownerId, 60))
      .filter((r) => r.ownerId === input.ownerId && (r.scope === "fact" || r.scope === "project"))
      .filter((r) => visibleTo(r, input.projectId));
    const known = new Set(existing.map((r) => normalizeContent(r.content).toLowerCase()));
    const turn = `user: ${input.userText}\nassistant: ${input.assistantText}`.slice(0, 4000);
    const system = `${EXTRACTION_SYSTEM}\ncurrent project: ${input.projectId ? "yes" : "none"}\nexisting memories: ${JSON.stringify(existing.map((r) => r.content).slice(0, 40))}`;
    const text = await deps.complete(system, turn);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return 0;
    const parsed = JSON.parse(match[0]) as { facts?: Array<{ content?: unknown; type?: unknown; scope?: unknown }> };
    const seen = new Set<string>();
    let stored = 0;
    for (const f of (parsed.facts ?? []).slice(0, 5)) {
      if (typeof f?.content !== "string" || typeof f?.type !== "string") continue;
      if (!FACT_TYPES.has(f.type as MemoryType)) continue;
      const content = normalizeContent(f.content);
      const key = content.toLowerCase();
      if (!content || known.has(key) || seen.has(key)) continue;
      seen.add(key);
      const scope: MemoryScope = f.scope === "project" && input.projectId ? "project" : "fact";
      await remember(deps, {
        scope,
        ownerId: input.ownerId,
        workspaceId: input.workspaceId,
        projectId: scope === "project" ? input.projectId : null,
        content,
        type: f.type as MemoryType,
        conversationId: input.conversationId,
      });
      stored += 1;
    }
    return stored;
  } catch (err) {
    deps.onError?.("fact extraction failed", err);
    return 0;
  }
}
