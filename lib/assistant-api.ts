import { listConversations, getConversation, type ConversationRecord, type ConversationSummary } from "@/lib/conversations"
import {
  listAssistantConversations,
  getAssistantConversation,
  listAssistantMessages,
  type AssistantContext,
  type AssistantConversation,
} from "@/lib/assistant-store"

// Response shapes for /api/conversations. Supabase conversations (the assistant's chats) are merged with the
// file store, which still holds runs, events and the older chats. Shape is a superset of the file summary.

export interface ApiConversationSummary extends ConversationSummary {
  projectId: string | null
  projectName: string | null
  /** False for older file-based chats (they stay under "No project" and cannot be moved). */
  editable: boolean
}

export interface ApiConversationDetail extends ApiConversationSummary {
  messages: Array<{ id: string; role: "user" | "assistant" | "agent"; text: string; agent: string; timestamp: number; runId?: string; meta?: Record<string, unknown> }>
  runs: ConversationRecord["runs"]
  events: ConversationRecord["events"]
}

function fromSupabase(c: AssistantConversation, file: ConversationSummary | undefined, messageCount: number): ApiConversationSummary {
  return {
    id: c.id,
    title: c.title,
    agent: c.agent,
    status: file?.status ?? "active",
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lastMessageAt: c.updatedAt,
    latestPreview: c.preview,
    project: c.projectName ?? undefined,
    projectId: c.projectId,
    projectName: c.projectName,
    editable: true,
    messageCount,
    runCount: file?.runCount ?? 0,
  }
}

function fromFile(s: ConversationSummary): ApiConversationSummary {
  return { ...s, projectId: null, projectName: null, editable: false }
}

export async function listForUser(ctx: AssistantContext | null, query?: string): Promise<ApiConversationSummary[]> {
  const fileList = await listConversations(query)
  const fileById = new Map(fileList.map((s) => [s.id, s]))
  if (!ctx) return fileList.map(fromFile)

  const rows = await listAssistantConversations(ctx)
  const supabaseIds = new Set(rows.map((r) => r.id))
  // Message counts in one query (ids only, no content).
  const counts = new Map<string, number>()
  if (rows.length > 0) {
    const { data } = await ctx.supabase.from("messages").select("conversation_id").in("conversation_id", rows.map((r) => r.id))
    for (const m of data ?? []) counts.set(m.conversation_id as string, (counts.get(m.conversation_id as string) ?? 0) + 1)
  }
  const own = rows.map((r) => fromSupabase(r, fileById.get(r.id), counts.get(r.id) ?? 0))
  // File records that share an id with a Supabase row are the runs shadow; they are not listed twice.
  const legacy = fileList.filter((s) => !supabaseIds.has(s.id)).map(fromFile)
  const normalized = query?.trim().toLowerCase()
  const all = [...own, ...legacy]
  return normalized
    ? all.filter((c) => [c.title, c.agent, c.latestPreview, c.projectName ?? ""].join(" ").toLowerCase().includes(normalized))
    : all
}

export async function detailForUser(ctx: AssistantContext | null, id: string): Promise<ApiConversationDetail | null> {
  const file = await getConversation(id)
  if (ctx) {
    const row = await getAssistantConversation(ctx, id)
    if (row) {
      const [messages, summaries] = await Promise.all([listAssistantMessages(ctx, id), listForUser(ctx)])
      const summary = summaries.find((s) => s.id === id)
      const base = summary ?? fromSupabase(row, undefined, messages.length)
      return {
        ...base,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.content,
          agent: m.agent,
          timestamp: Date.parse(m.createdAt),
          runId: typeof m.meta.runId === "string" ? m.meta.runId : undefined,
          meta: m.meta,
        })),
        runs: file?.runs ?? [],
        events: file?.events ?? [],
      }
    }
  }
  if (!file) return null
  const summary = (await listConversations()).find((s) => s.id === id)
  if (!summary) return null
  return {
    ...fromFile(summary),
    messages: file.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, agent: m.agent, timestamp: m.timestamp, runId: m.runId })),
    runs: file.runs,
    events: file.events,
  }
}
