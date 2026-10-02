/**
 * Admit queue worker. Narrow by design: it can only run the existing waitlist
 * invite flow for ONE email per row, only for a waitlist row that is still
 * 'joined' with a phone on file. No other admin powers, no "next N", capped
 * per run and per hour, and every request ends with a result string in the table.
 */
import { createServerClient } from '@/lib/supabase/server'
import { normalizeEmail } from '@/lib/waitlist'
import { runWaitlistInvites } from './waitlist-invites'

export const ADMITS_PER_RUN = 3
export const ADMITS_PER_HOUR = 10

interface QueueRow { id: string; email: string; requested_by: string }

async function finish(id: string, status: 'done' | 'failed' | 'skipped', result: string): Promise<void> {
  await createServerClient().from('waitlist_admit_queue')
    .update({ status, result: result.slice(0, 1000), processed_at: new Date().toISOString() }).eq('id', id)
}

export async function processAdmitQueue(): Promise<{ done: number; failed: number; skipped: number }> {
  const supabase = createServerClient()
  const out = { done: 0, failed: 0, skipped: 0 }
  const { data: claimed, error } = await supabase.rpc('claim_waitlist_admits', { p_limit: ADMITS_PER_RUN })
  if (error) throw new Error(`claim_waitlist_admits failed: ${error.message}`)
  const rows = (claimed ?? []) as QueueRow[]
  if (rows.length === 0) return out

  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await supabase.from('waitlist_admit_queue').select('id', { count: 'exact', head: true })
    .eq('status', 'done').gte('processed_at', since)
  let budget = ADMITS_PER_HOUR - (count ?? 0)

  for (const row of rows) {
    try {
      const email = normalizeEmail(row.email)
      if (!email) { await finish(row.id, 'skipped', 'not a valid email'); out.skipped++; continue }
      if (budget <= 0) {
        // Put it back for a later run instead of dropping it.
        await supabase.from('waitlist_admit_queue').update({ status: 'pending', processed_at: null }).eq('id', row.id)
        continue
      }
      const { data: person } = await supabase.from('waitlist').select('id, status, phone').eq('email', email).maybeSingle()
      if (!person) { await finish(row.id, 'skipped', 'no waitlist row for that email'); out.skipped++; continue }
      if (person.status !== 'joined') { await finish(row.id, 'skipped', `waitlist status is ${person.status}, not joined`); out.skipped++; continue }
      if (!person.phone) { await finish(row.id, 'skipped', 'no phone on file'); out.skipped++; continue }
      const result = await runWaitlistInvites(`admit-queue:${row.requested_by}`, { kind: 'email', email })
      budget--
      await finish(row.id, 'done', result)
      out.done++
    } catch (err) {
      await finish(row.id, 'failed', err instanceof Error ? err.message : String(err)).catch(() => undefined)
      out.failed++
    }
  }
  return out
}
