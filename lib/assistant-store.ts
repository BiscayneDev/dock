import type { SupabaseClient } from "@supabase/supabase-js"
import { currentUser, sessionClient } from "@/lib/tenancy"
import { loadWorkspaceId } from "@/lib/onboarding-server"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

// Assistant conversations in Supabase (migration 0004). Every call runs with the signed-in user's session,
// so RLS limits rows to the user's own workspace. project_id null = "No project".

export const NEW_CHAT_TITLE = "New chat"

export interface AssistantContext {
  supabase: SupabaseClient
  userId: string
  workspaceId: string
}

export interface AssistantConversation {
  id: string
  title: string
  agent: string
  projectId: string | null
  projectName: string | null
  preview: string
  createdAt: string
  updatedAt: string
}

export interface AssistantMessage {
  id: string
  role: "user" | "assistant" | "agent"
  content: string
  agent: string
  createdAt: string
  meta: Record<string, unknown>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/** Signed-in user and their workspace, or null when signed out (file-based fallback applies). */
export async function assistantContext(): Promise<AssistantContext | null> {
  try {
    const supabase = await sessionClient()
    const user = await currentUser(supabase)
    if (!user) return null
    const workspaceId = await loadWorkspaceId(supabase, user.id)
    if (!workspaceId) return null
    return { supabase, userId: user.id, workspaceId }
  } catch {
    return null
  }
}

interface ConversationRow {
  id: string
  title: string
  agent: string
  project_id: string | null
  preview: string
  created_at: string
  updated_at: string
  projects?: { name: string } | { name: string }[] | null
}

const SELECT = "id, title, agent, project_id, preview, created_at, updated_at, projects(name)"

function toConversation(row: ConversationRow): AssistantConversation {
  const project = Array.isArray(row.projects) ? row.projects[0] : row.projects
  return {
    id: row.id,
    title: row.title,
    agent: row.agent,
    projectId: row.project_id,
    projectName: project?.name ?? null,
    preview: row.preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listAssistantConversations(ctx: AssistantContext): Promise<AssistantConversation[]> {
  const { data, error } = await ctx.supabase
    .from("conversations")
    .select(SELECT)
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(200)
  if (error) throw new Error(`conversations: ${error.message}`)
  return ((data ?? []) as unknown as ConversationRow[]).map(toConversation)
}

export async function getAssistantConversation(ctx: AssistantContext, id: string): Promise<AssistantConversation | null> {
  if (!isUuid(id)) return null
  const { data, error } = await ctx.supabase.from("conversations").select(SELECT).eq("id", id).maybeSingle()
  if (error) throw new Error(`conversations: ${error.message}`)
  return data ? toConversation(data as unknown as ConversationRow) : null
}

/** Project belongs to the workspace (RLS also enforces this on write). */
export async function projectInWorkspace(ctx: AssistantContext, projectId: string): Promise<{ id: string; name: string } | null> {
  if (!isUuid(projectId)) return null
  const { data } = await ctx.supabase.from("projects").select("id, name").eq("id", projectId).eq("workspace_id", ctx.workspaceId).maybeSingle()
  return data ? { id: data.id as string, name: data.name as string } : null
}

export async function createAssistantConversation(
  ctx: AssistantContext,
  input: { title?: string; agent?: string; projectId?: string | null },
): Promise<AssistantConversation> {
  const { data, error } = await ctx.supabase
    .from("conversations")
    .insert({
      workspace_id: ctx.workspaceId,
      owner_id: ctx.userId,
      project_id: input.projectId ?? null,
      title: input.title?.trim().slice(0, 200) || NEW_CHAT_TITLE,
      agent: input.agent ?? CHIEF_RUNTIME_KEY,
    })
    .select(SELECT)
    .single()
  if (error || !data) throw new Error(`conversations: ${error?.message ?? "insert failed"}`)
  return toConversation(data as unknown as ConversationRow)
}

export async function updateAssistantConversation(
  ctx: AssistantContext,
  id: string,
  patch: { title?: string; projectId?: string | null },
): Promise<AssistantConversation | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) update.title = patch.title.trim().slice(0, 200) || NEW_CHAT_TITLE
  if (patch.projectId !== undefined) update.project_id = patch.projectId
  const { data, error } = await ctx.supabase.from("conversations").update(update).eq("id", id).select(SELECT).maybeSingle()
  if (error) throw new Error(`conversations: ${error.message}`)
  return data ? toConversation(data as unknown as ConversationRow) : null
}

export async function deleteAssistantConversation(ctx: AssistantContext, id: string): Promise<boolean> {
  const { data, error } = await ctx.supabase.from("conversations").delete().eq("id", id).select("id")
  if (error) throw new Error(`conversations: ${error.message}`)
  return (data ?? []).length > 0
}

export async function listAssistantMessages(ctx: AssistantContext, conversationId: string, limit = 500): Promise<AssistantMessage[]> {
  // Newest first from the database, returned oldest first, so a long chat keeps its latest turns.
  const { data, error } = await ctx.supabase
    .from("messages")
    .select("id, role, content, agent, created_at, meta")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`messages: ${error.message}`)
  return (data ?? [])
    .map((m) => ({
      id: m.id as string,
      role: m.role as AssistantMessage["role"],
      content: m.content as string,
      agent: m.agent as string,
      createdAt: m.created_at as string,
      meta: (m.meta ?? {}) as Record<string, unknown>,
    }))
    .reverse()
}

export async function appendAssistantMessage(
  ctx: AssistantContext,
  conversationId: string,
  message: { role: AssistantMessage["role"]; content: string; agent: string; meta?: Record<string, unknown> },
): Promise<void> {
  const { error } = await ctx.supabase.from("messages").insert({
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    agent: message.agent,
    meta: message.meta ?? {},
  })
  if (error) throw new Error(`messages: ${error.message}`)
  const now = new Date().toISOString()
  await ctx.supabase
    .from("conversations")
    .update({ updated_at: now, preview: message.content.slice(0, 160), agent: message.agent })
    .eq("id", conversationId)
}
