// Shipyard Memory for Dock (server only). Wires lib/memory-core.ts to Dock's Supabase (memory_items, migration 0009)
// and to the @shipyard/memory package for embeddings.
//
// Embeddings: only through an explicit gateway. The package falls back to OPENAI_API_KEY when its own
// EMBEDDINGS_* settings are absent, so this module refuses to embed unless EMBEDDINGS_BASE_URL and
// EMBEDDINGS_API_KEY are both set (Shipyard Inference /v1 is the intended value). Otherwise every row is
// stored without a vector and recall is keyword-based.
//
// Writes and reads use the service-role client, always filtered by the owner id the caller has already
// validated from the session (assistantContext). The /memory page and the API route use the same owner
// filters; RLS on memory_items protects direct client access.

import { configureMemory, currentEmbeddingModel, embedText } from "@shipyard/memory";
import { adminClient } from "@/lib/tenancy";
import { inferenceChat } from "@/lib/inference";
import {
  extractFacts as coreExtract,
  forget as coreForget,
  memoryPromptBlock,
  recall as coreRecall,
  remember as coreRemember,
  type MemoryDeps,
  type MemoryRepo,
  type MemoryRow,
  type MemoryScope,
  type RecallHit,
  type VectorHit,
} from "@/lib/memory-core";

export type { MemoryRow, MemoryScope, RecallHit } from "@/lib/memory-core";

export interface MemoryOwner {
  userId: string;
  workspaceId: string;
}

const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => console.info(`[memory] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(`[memory] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) => console.error(`[memory] ${msg}`, ctx ?? ""),
};

/** True only when the package may call an explicitly configured embeddings gateway. */
export function embeddingsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.EMBEDDINGS_BASE_URL && env.EMBEDDINGS_API_KEY);
}

// The package reads its config through this module; configure it once with Dock's client and logger.
configureMemory({
  getSupabase: () => adminClient(),
  logger,
  complete: async ({ system, user }) => (await inferenceChat({ message: user, system })) ?? "",
});

async function embed(text: string): Promise<number[] | null> {
  if (!embeddingsConfigured()) return null;
  return embedText(text);
}

const SELECT = "id, owner_id, workspace_id, project_id, scope, type, content, conversation_id, embedding_model, created_at, projects(name)";

type Raw = {
  id: string;
  owner_id: string;
  workspace_id: string;
  project_id: string | null;
  scope: MemoryScope;
  type: MemoryRow["type"];
  content: string;
  conversation_id: string | null;
  embedding_model: string | null;
  created_at: string;
  projects?: { name: string } | { name: string }[] | null;
};

function toRow(r: Raw): MemoryRow {
  const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
  return {
    id: r.id,
    ownerId: r.owner_id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    projectName: project?.name ?? null,
    scope: r.scope,
    type: r.type,
    content: r.content,
    conversationId: r.conversation_id,
    embeddingModel: r.embedding_model,
    createdAt: r.created_at,
  };
}

function supabaseRepo(): MemoryRepo {
  const db = adminClient();
  return {
    async insert(row) {
      const { data, error } = await db
        .from("memory_items")
        .insert({
          owner_id: row.ownerId,
          workspace_id: row.workspaceId,
          project_id: row.projectId,
          scope: row.scope,
          type: row.type,
          content: row.content,
          conversation_id: row.conversationId,
          ...(row.embedding ? { embedding: row.embedding, embedding_model: row.embeddingModel } : {}),
        })
        .select(SELECT)
        .single();
      if (error || !data) throw new Error(`memory insert: ${error?.message ?? "no row"}`);
      return toRow(data as unknown as Raw);
    },
    async listRecent(ownerId, limit) {
      const { data, error } = await db
        .from("memory_items")
        .select(SELECT)
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`memory list: ${error.message}`);
      return ((data ?? []) as unknown as Raw[]).map(toRow);
    },
    async delete(ownerId, id) {
      const { data, error } = await db
        .from("memory_items")
        .delete()
        .eq("id", id)
        .eq("owner_id", ownerId)
        .select("id");
      if (error) throw new Error(`memory delete: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async vectorMatch({ ownerId, projectId, model, embedding, limit }): Promise<VectorHit[]> {
      const { data, error } = await db.rpc("match_memory_items", {
        p_owner: ownerId,
        p_project: projectId,
        p_model: model,
        p_embedding: embedding,
        p_limit: limit,
      });
      if (error) throw new Error(`match_memory_items: ${error.message}`);
      const ids = ((data ?? []) as Array<{ id: string; similarity: number }>);
      if (ids.length === 0) return [];
      const { data: rows, error: rowsError } = await db
        .from("memory_items")
        .select(SELECT)
        .eq("owner_id", ownerId)
        .in("id", ids.map((h) => h.id));
      if (rowsError) throw new Error(`memory rows: ${rowsError.message}`);
      const byId = new Map(((rows ?? []) as unknown as Raw[]).map((r) => [r.id, toRow(r)]));
      return ids
        .map((h) => ({ row: byId.get(h.id), similarity: Number(h.similarity) }))
        .filter((h): h is VectorHit => Boolean(h.row));
    },
  };
}

function deps(): MemoryDeps {
  return {
    repo: supabaseRepo(),
    embed,
    embeddingModel: currentEmbeddingModel(),
    complete: async (system, user) => (await inferenceChat({ message: user, system })) ?? "",
    onError: (msg, err) => logger.error(msg, { error: err instanceof Error ? err.message : String(err) }),
  };
}

/** Store one item in a scope for this owner (and project, for project scope). */
export function remember(
  scope: MemoryScope,
  owner: MemoryOwner,
  projectId: string | null,
  content: string,
  meta: { type?: MemoryRow["type"]; conversationId?: string | null } = {},
): Promise<MemoryRow> {
  return coreRemember(deps(), { scope, ownerId: owner.userId, workspaceId: owner.workspaceId, projectId, content, ...meta });
}

/** Scope-labelled recall for this owner in this project context (owner-wide items plus this project only). */
export function recall(owner: MemoryOwner, query: string, projectId: string | null, limit = 8): Promise<RecallHit[]> {
  return coreRecall(deps(), { ownerId: owner.userId, query, projectId, limit });
}

/** Owner-only delete of one item. */
export function forget(owner: MemoryOwner, id: string): Promise<boolean> {
  return coreForget(deps(), owner.userId, id);
}

/** Facts and project knowledge for the /memory page (conversation turns excluded). */
export async function listDurable(owner: MemoryOwner, limit = 300): Promise<MemoryRow[]> {
  const rows = await supabaseRepo().listRecent(owner.userId, limit);
  return rows.filter((r) => r.scope === "fact" || r.scope === "project");
}

/** Extract durable facts from one finished turn. Returns the number stored. Never throws. */
export function extractFacts(
  owner: MemoryOwner,
  conversationId: string | null,
  projectId: string | null,
  turn: { userText: string; assistantText: string },
): Promise<number> {
  return coreExtract(deps(), {
    ownerId: owner.userId,
    workspaceId: owner.workspaceId,
    projectId,
    conversationId,
    userText: turn.userText,
    assistantText: turn.assistantText,
  });
}

/**
 * After a finished assistant turn: write the conversation scope, then extract facts. Call without await
 * from the chat route so the reply is never blocked. Never throws.
 */
export async function recordTurn(
  owner: MemoryOwner,
  conversationId: string,
  projectId: string | null,
  turn: { userText: string; assistantText: string },
): Promise<void> {
  try {
    const text = `User: ${turn.userText}\nAssistant: ${turn.assistantText}`.slice(0, 3000);
    if (text.trim().length > 0) {
      await remember("conversation", owner, projectId, text, { type: "conversation", conversationId });
    }
    await extractFacts(owner, conversationId, projectId, turn);
  } catch (err) {
    logger.error("recordTurn failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** "What you remember" block for the Chief's prompt, or null when empty. */
export async function promptBlock(owner: MemoryOwner, query: string, projectId: string | null): Promise<string | null> {
  const hits = await recall(owner, query, projectId, 8).catch(() => []);
  const block = memoryPromptBlock(hits, projectId);
  if (block) return block;
  // Nothing matched the message: fall back to the newest durable items so the block still reflects the owner.
  const recent = await recall(owner, "", projectId, 8).catch(() => []);
  return memoryPromptBlock(recent, projectId);
}
