import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

export type ConversationStatus = "active" | "completed" | "failed" | "paused"
export type EventType =
  | "conversation.created"
  | "message.user"
  | "message.assistant"
  | "message.agent"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "intervention.sent"
  | "task.linked"
  | "activity.started"
  | "activity.completed"
  | "activity.reviewed"

export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "agent"
  text: string
  agent: string
  timestamp: number
  runId?: string
}

/** One model call (HTTP request) inside a run. Numbers and names only. */
export interface RunModelCall {
  index: number
  model: string | null
  provider: string | null
  startedAt: string | null
  endedAt: string | null
  inputTokens: number | null
  outputTokens: number | null
  /** USD from the Shipyard gateway. Null = not reported (e.g. BYO-key providers). */
  costUsd: number | null
}

export interface RunTelemetry {
  calls: RunModelCall[]
  /** Sums over calls; null when any call is unknown. */
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}

export interface ConversationRun {
  id: string
  conversationId: string
  agent: string
  runtime: string
  status: "running" | "completed" | "failed"
  startedAt: string
  completedAt?: string
  taskId?: string
  error?: string
  /** Per-call tokens and cost. Absent on legacy runs. */
  telemetry?: RunTelemetry
}

export interface ConversationEvent {
  id: string
  conversationId: string
  type: EventType
  timestamp: string
  agent?: string
  runId?: string
  summary: string
  data?: Record<string, unknown>
}

export interface ConversationRecord {
  id: string
  title: string
  agent: string
  status: ConversationStatus
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  latestPreview: string
  project?: string
  taskId?: string
  messages: ConversationMessage[]
  runs: ConversationRun[]
  events: ConversationEvent[]
}

interface ConversationStore {
  conversations: ConversationRecord[]
}

export interface ConversationSummary {
  id: string
  title: string
  agent: string
  status: ConversationStatus
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  latestPreview: string
  project?: string
  taskId?: string
  messageCount: number
  runCount: number
}

const DATA_PATH = join(process.cwd(), "data", "conversations.json")
const KV_KEY = "conversations"
const MAX_CONVERSATIONS = 200
const MAX_MESSAGES_PER_CONVERSATION = 300
const MAX_EVENTS_PER_CONVERSATION = 500
const MAX_RUNS_PER_CONVERSATION = 100
const DEFAULT_CONVERSATION_ID = "main-chat"

function defaultStore(): ConversationStore {
  return { conversations: [] }
}

// ── Serverless fallback ──────────────────────────────────────────
// Vercel functions get a read-only filesystem, so file writes throw EROFS.
// Without a KV store configured, keep conversation state in memory for the
// lifetime of the instance (seeded from any bundled data file).
let memoryStore: ConversationStore | null = null

function useMemoryStore(): boolean {
  return (
    (Boolean(process.env.VERCEL) || Boolean(process.env.VERCEL_ENV)) &&
    !process.env.KV_REST_API_URL
  )
}

async function readStoreFromFile(): Promise<ConversationStore> {
  try {
    const raw = await readFile(DATA_PATH, "utf-8")
    const parsed = JSON.parse(raw) as ConversationStore
    if (parsed && Array.isArray(parsed.conversations)) return parsed
    return defaultStore()
  } catch {
    return defaultStore()
  }
}

async function writeStoreToFile(store: ConversationStore): Promise<void> {
  await mkdir(dirname(DATA_PATH), { recursive: true })
  await writeFile(DATA_PATH, JSON.stringify(store, null, 2), "utf-8")
}

async function readStore(): Promise<ConversationStore> {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import("@vercel/kv")
      const store = await kv.get<ConversationStore>(KV_KEY)
      if (store && Array.isArray(store.conversations)) return store
    } catch {
      // fall through
    }
  }
  if (useMemoryStore()) {
    // Serverless: read-only filesystem. Keep state in memory for this
    // instance, seeded from any bundled data file. Cold starts lose
    // history — set KV_REST_API_URL for durable persistence.
    if (!memoryStore) memoryStore = await readStoreFromFile()
    return memoryStore
  }
  return readStoreFromFile()
}

async function writeStore(store: ConversationStore): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    try {
      const { kv } = await import("@vercel/kv")
      await kv.set(KV_KEY, store)
      return
    } catch {
      // fall through
    }
  }
  if (useMemoryStore()) {
    memoryStore = store
    return
  }
  return writeStoreToFile(store)
}

function summarize(conversation: ConversationRecord): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    agent: conversation.agent,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    latestPreview: conversation.latestPreview,
    project: conversation.project,
    taskId: conversation.taskId,
    messageCount: conversation.messages.length,
    runCount: conversation.runs.length,
  }
}

function sortConversations(conversations: ConversationRecord[]): ConversationRecord[] {
  return conversations.slice().sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
}

function trimConversation(conversation: ConversationRecord): ConversationRecord {
  return {
    ...conversation,
    messages: conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
    events: conversation.events.slice(-MAX_EVENTS_PER_CONVERSATION),
    runs: conversation.runs.slice(-MAX_RUNS_PER_CONVERSATION),
  }
}

function upsertConversation(store: ConversationStore, conversation: ConversationRecord): ConversationStore {
  const others = store.conversations.filter((item) => item.id !== conversation.id)
  const next = [trimConversation(conversation), ...sortConversations(others)]
  return { conversations: next.slice(0, MAX_CONVERSATIONS) }
}

function taskConversationId(taskId: string): string {
  return `task-${taskId}`
}

export async function listConversations(query?: string): Promise<ConversationSummary[]> {
  const store = await readStore()
  const normalized = query?.trim().toLowerCase()
  const conversations = normalized
    ? store.conversations.filter((conversation) => {
        const haystack = [
          conversation.title,
          conversation.agent,
          conversation.latestPreview,
          conversation.project ?? "",
          conversation.taskId ?? "",
        ]
          .join(" ")
          .toLowerCase()
        return haystack.includes(normalized)
      })
    : store.conversations
  return sortConversations(conversations).map(summarize)
}

export async function getConversation(id: string): Promise<ConversationRecord | null> {
  const store = await readStore()
  return store.conversations.find((conversation) => conversation.id === id) ?? null
}

export async function createConversation(input: {
  title?: string
  agent?: string
  project?: string
  taskId?: string
  id?: string
} = {}): Promise<ConversationRecord> {
  const now = new Date().toISOString()
  const conversationId = input.id ?? randomUUID()
  const conversation: ConversationRecord = {
    id: conversationId,
    title: input.title?.trim() || "Untitled conversation",
    agent: input.agent ?? CHIEF_RUNTIME_KEY,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    latestPreview: "",
    project: input.project,
    taskId: input.taskId,
    messages: [],
    runs: [],
    events: [
      {
        id: randomUUID(),
        conversationId,
        type: "conversation.created",
        timestamp: now,
        agent: input.agent ?? CHIEF_RUNTIME_KEY,
        summary: `Conversation created for ${(input.agent ?? CHIEF_RUNTIME_KEY).replace(/-/g, " ")}`,
      },
    ],
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, conversation))
  return conversation
}

export async function ensureConversation(
  id: string,
  defaults: { title?: string; agent?: string; project?: string; taskId?: string } = {}
): Promise<ConversationRecord> {
  const existing = await getConversation(id)
  if (existing) return existing
  return createConversation({ ...defaults, id })
}

export async function ensureTaskConversation(input: {
  taskId: string
  title: string
  agent?: string
}): Promise<ConversationRecord> {
  return ensureConversation(taskConversationId(input.taskId), {
    title: input.title,
    agent: input.agent ?? CHIEF_RUNTIME_KEY,
    taskId: input.taskId,
  })
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<ConversationRecord, "title" | "status" | "agent" | "project" | "taskId">>
): Promise<ConversationRecord | null> {
  const existing = await getConversation(id)
  if (!existing) return null
  const updated: ConversationRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, updated))
  return updated
}

export async function deleteConversation(id: string): Promise<boolean> {
  const store = await readStore()
  const filtered = store.conversations.filter((conversation) => conversation.id !== id)
  if (filtered.length === store.conversations.length) return false
  await writeStore({ conversations: filtered })
  return true
}

export async function appendEvent(
  conversationId: string,
  event: Omit<ConversationEvent, "id" | "conversationId" | "timestamp"> & { timestamp?: string }
): Promise<ConversationEvent> {
  const conversation = await ensureConversation(conversationId)
  const nextEvent: ConversationEvent = {
    id: randomUUID(),
    conversationId,
    timestamp: event.timestamp ?? new Date().toISOString(),
    type: event.type,
    agent: event.agent,
    runId: event.runId,
    summary: event.summary,
    data: event.data,
  }
  const updated: ConversationRecord = {
    ...conversation,
    updatedAt: nextEvent.timestamp,
    events: [...conversation.events, nextEvent],
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, updated))
  return nextEvent
}

export async function appendMessage(
  conversationId: string,
  message: Omit<ConversationMessage, "id"> & { id?: string }
): Promise<ConversationMessage> {
  const conversation = await ensureConversation(conversationId)
  const timestampIso = new Date(message.timestamp).toISOString()
  const nextMessage: ConversationMessage = {
    id: message.id ?? randomUUID(),
    role: message.role,
    text: message.text,
    agent: message.agent,
    timestamp: message.timestamp,
    runId: message.runId,
  }
  const updated: ConversationRecord = {
    ...conversation,
    agent: message.agent || conversation.agent,
    updatedAt: timestampIso,
    lastMessageAt: timestampIso,
    latestPreview: message.text.slice(0, 160),
    messages: [...conversation.messages, nextMessage],
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, updated))
  return nextMessage
}

export async function startRun(
  conversationId: string,
  input: { agent: string; runtime: string; taskId?: string }
): Promise<ConversationRun> {
  const conversation = await ensureConversation(conversationId, { agent: input.agent, taskId: input.taskId })
  const now = new Date().toISOString()
  const run: ConversationRun = {
    id: randomUUID(),
    conversationId,
    agent: input.agent,
    runtime: input.runtime,
    status: "running",
    startedAt: now,
    taskId: input.taskId,
  }
  const updated: ConversationRecord = {
    ...conversation,
    agent: input.agent,
    taskId: input.taskId ?? conversation.taskId,
    status: "active",
    updatedAt: now,
    runs: [...conversation.runs, run],
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, updated))
  return run
}

export async function finishRun(
  conversationId: string,
  runId: string,
  input: { status: "completed" | "failed"; error?: string; telemetry?: RunTelemetry }
): Promise<ConversationRun | null> {
  const conversation = await getConversation(conversationId)
  if (!conversation) return null

  const now = new Date().toISOString()
  let finalRun: ConversationRun | null = null
  const runs = conversation.runs.map((run) => {
    if (run.id !== runId) return run
    finalRun = {
      ...run,
      status: input.status,
      completedAt: now,
      error: input.error,
      telemetry: input.telemetry ?? run.telemetry,
    }
    return finalRun
  })

  if (!finalRun) return null

  const updated: ConversationRecord = {
    ...conversation,
    status: input.status === "failed" ? "failed" : conversation.status,
    updatedAt: now,
    runs,
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, updated))
  return finalRun
}

export async function getRun(
  conversationId: string,
  runId: string
): Promise<{ run: ConversationRun; conversation: ConversationRecord } | null> {
  const conversation = await getConversation(conversationId)
  if (!conversation) return null
  const run = conversation.runs.find((item) => item.id === runId)
  if (!run) return null
  return { run, conversation }
}

export async function getDefaultConversation(): Promise<ConversationRecord> {
  return ensureConversation(DEFAULT_CONVERSATION_ID, {
    title: "Main chat",
    agent: CHIEF_RUNTIME_KEY,
  })
}

export async function replaceDefaultConversationMessages(
  messages: ConversationMessage[]
): Promise<ConversationRecord> {
  const existing = await getDefaultConversation()
  const sortedMessages = messages.slice().sort((a, b) => a.timestamp - b.timestamp)
  const latest = sortedMessages[sortedMessages.length - 1]
  const updated: ConversationRecord = {
    ...existing,
    updatedAt: latest ? new Date(latest.timestamp).toISOString() : existing.updatedAt,
    lastMessageAt: latest ? new Date(latest.timestamp).toISOString() : existing.lastMessageAt,
    latestPreview: latest?.text.slice(0, 160) ?? "",
    messages: sortedMessages.slice(-MAX_MESSAGES_PER_CONVERSATION),
  }
  const store = await readStore()
  await writeStore(upsertConversation(store, updated))
  return updated
}

export async function listAllEvents(limit = 200): Promise<ConversationEvent[]> {
  const store = await readStore()
  return store.conversations
    .flatMap((conversation) => conversation.events)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, limit)
}
