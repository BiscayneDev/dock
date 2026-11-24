import { BIN, GOG_ACCOUNT } from "@/lib/config"
import { NextResponse } from "next/server"
import { execFile } from "child_process"
import { promisify } from "util"
import { assistantContext } from "@/lib/assistant-store"
import { listAlerts, type AlertRecord } from "@/lib/alerts"
import { listEventsForRuns } from "@/lib/queue"
import { queryInbox, type InboxFilter, type InboxItem } from "@/lib/inbox-query"
import {
  expireDueDecisions,
  listDecisions,
  syncRunDecisions,
  type VerdictRow,
} from "../decisions/store"

const execFileAsync = promisify(execFile)

export interface EmailEntry {
  id: string
  from: string
  fromName: string
  subject: string
  snippet: string
  date: string
}

const NOISE_PATTERNS = [
  "noreply",
  "no-reply",
  "newsletter",
  "notifications@",
  "updates@",
  "donotreply",
  "do-not-reply",
  "mailer@",
  "bounce@",
  "support@",
  "automated@",
  "alert@",
]

function isNoise(from: string): boolean {
  const lower = from.toLowerCase()
  return NOISE_PATTERNS.some((p) => lower.includes(p))
}

function extractName(from: string): string {
  // "John Doe <john@example.com>" -> "John Doe"
  const match = from.match(/^([^<]+)</)
  if (match) return match[1].trim()
  // "john@example.com" -> "john"
  const emailMatch = from.match(/([^@<\s]+)@/)
  if (emailMatch) return emailMatch[1]
  return from
}

interface RawMessage {
  id?: string
  from?: string
  subject?: string
  snippet?: string
  date?: string
  internalDate?: string
}

/**
 * Gmail is an advisory source only: it never decides what the inbox means. On Vercel the local gog
 * binary does not exist, so this returns [] there (the old behaviour) while decisions still load.
 */
async function readAdvisoryEmails(): Promise<EmailEntry[]> {
  if (process.env.VERCEL || process.env.VERCEL_ENV) return []
  try {
    const { stdout } = await execFileAsync(
      BIN.gog,
      [
        "gmail",
        "messages",
        "search",
        "in:inbox is:unread newer_than:2d",
        "--max",
        "8",
        "--json",
        "--account",
        GOG_ACCOUNT,
      ],
      { timeout: 10000 },
    )
    const raw = JSON.parse(stdout) as RawMessage[] | { messages?: RawMessage[] }
    const messages: RawMessage[] = Array.isArray(raw) ? raw : (raw.messages ?? [])
    return messages
      .filter((m) => !isNoise(m.from ?? ""))
      .slice(0, 5)
      .map((m) => ({
        id: m.id ?? String(Math.random()),
        from: m.from ?? "",
        fromName: extractName(m.from ?? ""),
        subject: m.subject ?? "(no subject)",
        snippet: m.snippet ?? "",
        date: m.date ?? m.internalDate ?? new Date().toISOString(),
      }))
  } catch {
    return []
  }
}

function verdictView(row: VerdictRow) {
  return {
    id: row.id,
    decisionId: row.decision_id,
    actorId: row.actor_id,
    verdict: row.verdict,
    status: row.status,
    artifactHash: row.artifact_hash,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
  }
}

function emptyCounts() {
  return { all: 0, "needs-you": 0, running: 0, done: 0 }
}

/**
 * GET /api/inbox — one queue of human decisions, with alerts, runs, briefs and recent messages
 * folded in. Decisions are the primary meaning; email and calendar are advisory sources. The
 * legacy `emails` field stays so existing consumers keep working.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const filterParam = params.get("filter") ?? "all"
  const filter: InboxFilter =
    filterParam === "needs-you" || filterParam === "running" || filterParam === "done" ? filterParam : "all"
  const search = params.get("q") ?? ""

  const emails = await readAdvisoryEmails()
  const ctx = await assistantContext()
  if (!ctx) {
    return NextResponse.json({
      emails,
      items: [],
      counts: emptyCounts(),
      filter,
      signedIn: false,
      sources: { decisions: false, alerts: false, runs: false, briefs: false, messages: false, email: true },
    })
  }

  const sources = {
    decisions: false,
    alerts: false,
    runs: false,
    briefs: false,
    messages: false,
    email: true,
  }

  let decisions: Awaited<ReturnType<typeof listDecisions>> = []
  let alerts: AlertRecord[] = []
  let runs: Record<string, unknown>[] = []
  let briefs: Record<string, unknown>[] = []
  let messages: Record<string, unknown>[] = []

  try {
    const now = Date.now()
    await expireDueDecisions(ctx.supabase, ctx.workspaceId, now)

    const { data: runRows, error: runsError } = await ctx.supabase
      .from("task_runs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100)
    if (runsError) throw new Error(runsError.message)
    runs = (runRows ?? []) as Record<string, unknown>[]
    sources.runs = true

    const awaiting = runs.filter((r) => r.status === "awaiting_approval").map((r) => String(r.id))
    const events = await listEventsForRuns(ctx.supabase, awaiting)
    const eventsByRun = new Map<string, Array<{ kind: string; data: Record<string, unknown> }>>()
    for (const e of events) {
      const list = eventsByRun.get(e.runId) ?? []
      list.push({ kind: e.kind, data: e.data })
      eventsByRun.set(e.runId, list)
    }
    await syncRunDecisions(
      ctx.supabase,
      ctx.workspaceId,
      ctx.userId,
      runs.map((r) => ({
        id: String(r.id),
        status: String(r.status),
        payload: (r.payload as Record<string, unknown>) ?? {},
      })),
      eventsByRun,
    )
    decisions = await listDecisions(ctx.supabase, ctx.workspaceId)
    sources.decisions = true
  } catch {
    // A failed source must not blank the whole inbox; the other sources still render.
  }

  try {
    alerts = await listAlerts()
    sources.alerts = true
  } catch {
    alerts = []
  }

  try {
    const { data, error } = await ctx.supabase
      .from("project_briefs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    briefs = (data ?? []) as Record<string, unknown>[]
    sources.briefs = true
  } catch {
    briefs = []
  }

  try {
    const { data, error } = await ctx.supabase
      .from("messages")
      .select("id, role, content, agent, conversation_id, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    messages = (data ?? []) as Record<string, unknown>[]
    sources.messages = true
  } catch {
    messages = []
  }

  const result = queryInbox({
    decisions: decisions.map((d) => {
      const withVerdicts = d as typeof d & { verdicts?: VerdictRow[] }
      return {
        ...d,
        verdicts: (withVerdicts.verdicts ?? []).map(verdictView),
      }
    }) as never,
    alerts: alerts as never,
    runs: runs as never,
    briefs: briefs as never,
    messages: messages.map((m) => ({
      ...m,
      unread: (m.meta as { unread?: boolean } | null)?.unread === true,
    })) as never,
  }, { filter, search })

  const items: InboxItem[] = result.items
  return NextResponse.json({
    emails,
    items,
    counts: result.counts,
    filter: result.filter,
    signedIn: true,
    sources,
  })
}
