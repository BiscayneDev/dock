import { randomUUID } from 'crypto'

export type RunStage = 'context' | 'gateway' | 'tool' | 'synthesis' | 'reply_ready' | 'reply_attempted' | 'deadline' | 'failed'

/** No message bodies, arguments, results, tokens or raw error strings. */
export function runStageRecorder(chatGuid: string, messageId?: string) {
    const runId = randomUUID()
    return async (stage: RunStage, detail?: string): Promise<void> => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) return
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 750)
        try {
            const res = await fetch(`${url}/rest/v1/dinghy_run_stages`, {
                method: 'POST', signal: controller.signal,
                headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ run_id: runId, chat_guid: chatGuid, message_id: messageId ?? null, stage, detail: detail?.slice(0,80) ?? null }),
            })
            if (!res.ok) console.warn('run-stage write failed', res.status)
        } catch {
            console.warn('run-stage write unavailable')
        } finally { clearTimeout(timer) }
    }
}
