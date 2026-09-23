/**
 * Inbound dedupe + outbound retry queue (migration 015). Exactly-once
 * inbound handling on message.id; at-least-once outbound delivery via a
 * leased retry queue swept by /api/cron/spectrum-sweep.
 */

import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { OUTBOX_LEASE_MS, computeBackoffMs } from './config'

export type OutboxKind = 'reply' | 'connect_link' | 'error_notice'

export interface OutboxRow {
    id: string
    chat_guid: string
    kind: OutboxKind
    text: string
    attempts: number
}

/** Backoff between dedupe claim attempts (~15s total), then give up. */
export const DEDUPE_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000]

/**
 * Claim an inbound delivery. Returns true exactly once per message id: when
 * this call owns the delivery and should process it. Returns false for a
 * redelivery, and also when the database stays unreachable through every
 * retry. Duplicate replies were worse than a dropped message during a
 * multi-second outage (and Spectrum's own redelivery usually lands after the
 * DB is back, when the claim succeeds).
 *
 * Each call uses one claim_id across its retries, so an insert that landed
 * but lost its response is recognised as ours on the next try (migration 021).
 */
export async function claimInboundDelivery(
    messageId: string,
    chatGuid: string,
    delays: number[] = DEDUPE_RETRY_DELAYS_MS
): Promise<boolean> {
    const supabase = createServerClient()
    const claimId = randomUUID()
    for (let attempt = 0; ; attempt++) {
        try {
            const { data, error } = await supabase.rpc('claim_inbound_delivery', {
                p_message_id: messageId,
                p_chat_guid: chatGuid,
                p_claim_id: claimId,
            })
            if (!error) return data === true
            console.error(`dedupe claim failed (attempt ${attempt + 1}):`, error.message)
        } catch (err) {
            console.error(`dedupe claim threw (attempt ${attempt + 1}):`, err instanceof Error ? err.message : String(err))
        }
        if (attempt >= delays.length) {
            console.error(`dedupe unavailable - message ${messageId} (${chatGuid}) NOT processed`)
            return false
        }
        await new Promise((r) => setTimeout(r, delays[attempt]))
    }
}

/** Enqueue a text send. Returns the row id for self-claim by the enqueuer. */
export async function enqueueOutbox(chatGuid: string, kind: OutboxKind, text: string): Promise<string | null> {
    const supabase = createServerClient()
    const { data, error } = await supabase
        .from('spectrum_outbox')
        .insert({ chat_guid: chatGuid, kind, text })
        .select('id')
        .single()
    if (error) {
        console.error('outbox enqueue failed:', error.message)
        return null
    }
    return data.id as string
}

/** Lease-claim a batch of due rows via the migration 015 SQL function. */
export async function claimOutboxBatch(batchSize = 20): Promise<OutboxRow[]> {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc('claim_spectrum_outbox', {
        lease_ms: OUTBOX_LEASE_MS,
        batch_size: batchSize,
    })
    if (error) {
        console.error('outbox claim failed:', error.message)
        return []
    }
    return (data ?? []) as OutboxRow[]
}

export async function markOutboxSent(id: string): Promise<void> {
    const supabase = createServerClient()
    await supabase
        .from('spectrum_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), lease_claimed_at: null, last_error: null })
        .eq('id', id)
}

/** Failed attempt: release the lease and back off the next retry. */
export async function markOutboxFailed(row: OutboxRow, err: unknown): Promise<void> {
    const supabase = createServerClient()
    const next = new Date(Date.now() + computeBackoffMs(row.attempts)).toISOString()
    await supabase
        .from('spectrum_outbox')
        .update({
            lease_claimed_at: null,
            next_attempt_at: next,
            last_error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', row.id)
}
