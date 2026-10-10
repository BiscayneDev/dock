import { createServerClient } from '@/lib/supabase/server'

/**
 * Steer while working. Each inbound text already runs in its own function
 * invocation, so a second text mid-task is answered without waiting. What was
 * missing: the new turn did not know the earlier request was still running, so
 * it could redo the work or answer a question about it blindly. This reads the
 * run-stage breadcrumbs (migration 067) to find runs still in flight for the
 * chat and gives the new turn a short note about them. Metadata only.
 */

export type StageRow = { run_id: string; message_id: string | null; stage: string; created_at: string }

const TERMINAL = new Set(['reply_attempted', 'deadline', 'failed'])
/** Turns stop at 85s (turn-budget.ts); a run silent for longer is dead or finished. */
export const ACTIVE_RUN_WINDOW_MS = 95_000
const LOOKUP_TIMEOUT_MS = 750

export type ActiveRun = { runId: string; messageId: string | null; startedAt: number }

/** Runs whose newest breadcrumb is non-terminal and recent, excluding this message's own run. */
export function activeRunsFrom(rows: StageRow[], now: number, currentMessageId?: string): ActiveRun[] {
    const byRun = new Map<string, StageRow[]>()
    for (const r of rows) byRun.set(r.run_id, [...(byRun.get(r.run_id) ?? []), r])
    const out: ActiveRun[] = []
    for (const [runId, list] of byRun) {
        const times = list.map((r) => Date.parse(r.created_at)).filter((t) => Number.isFinite(t))
        if (times.length === 0) continue
        const newest = list.reduce((a, b) => (Date.parse(b.created_at) >= Date.parse(a.created_at) ? b : a))
        if (TERMINAL.has(newest.stage)) continue
        if (now - Math.max(...times) > ACTIVE_RUN_WINDOW_MS) continue
        const messageId = list.find((r) => r.message_id)?.message_id ?? null
        if (currentMessageId && messageId === currentMessageId) continue
        out.push({ runId, messageId, startedAt: Math.min(...times) })
    }
    return out.sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * The note for the system prompt. earlierRequest is the user's previous text
 * (from history), shortened; null when unknown.
 */
export function steerNote(runs: ActiveRun[], earlierRequest: string | null): string | null {
    if (runs.length === 0) return null
    const what = earlierRequest ? ` ("${earlierRequest.replace(/\s+/g, ' ').trim().slice(0, 160)}")` : ''
    return (
        `Heads up: an earlier request from this chat${what} is still being worked on in a parallel run and will answer on its own. ` +
        `Do not redo it, restart it, or answer it here, and do not repeat any send or change it may be making. ` +
        `Answer only the newest message. If the newest message is about that running task, say it is still in progress. ` +
        `If it asks to stop or change it, say plainly that a running action cannot be pulled back, and tell them to check before retrying.`
    )
}

/** Last user text before the current one, from loaded history. */
export function earlierUserText(history: { role: string; content: string }[], current: string): string | null {
    for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i]
        if (m.role !== 'user') continue
        if (m.content === current) continue
        return m.content
    }
    return null
}

/** Fails open: any error or a slow lookup means "nothing running". */
export async function loadActiveRuns(chatGuid: string, currentMessageId?: string, now = Date.now()): Promise<ActiveRun[]> {
    try {
        const since = new Date(now - ACTIVE_RUN_WINDOW_MS - 5_000).toISOString()
        const query = createServerClient()
            .from('dinghy_run_stages')
            .select('run_id,message_id,stage,created_at')
            .eq('chat_guid', chatGuid)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(60)
            .then((res: { data: StageRow[] | null; error: unknown }) => (res.error || !res.data ? [] : activeRunsFrom(res.data, now, currentMessageId)))
        return await Promise.race([query, new Promise<ActiveRun[]>((r) => setTimeout(() => r([]), LOOKUP_TIMEOUT_MS))])
    } catch {
        return []
    }
}
