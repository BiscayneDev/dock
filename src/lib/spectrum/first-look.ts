/**
 * The first look for people who connect Google from the start page.
 *
 * Photon's shared pool will not text a registered user first, so the look is
 * stored on their waitlist row and delivered as the reply to their first text.
 * Deterministic and headers only: no model sees it here. The stored text is
 * Google-derived, so it is cleared the moment it is claimed for delivery.
 */
import { createServerClient } from '@/lib/supabase/server'
import type { FirstLookStatus } from './start-link'

export function phoneFromChatGuid(chatGuid: string): string | null {
  const m = chatGuid.match(/^any;-;(\+[1-9]\d{7,14})$/)
  return m ? m[1] : null
}

/** Join the first finding and the research digest into one reply. Null when neither has anything real. */
export function composeFirstLook(finding: string | null, digest: string | null): string | null {
  const parts = [finding, digest].map((p) => (p ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join('\n\n') : null
}

export async function markFirstLookPending(phone: string): Promise<void> {
  const { error } = await createServerClient().from('waitlist')
    .update({ first_look_status: 'pending', first_look_at: new Date().toISOString() })
    .eq('phone', phone).in('status', ['joined', 'invited', 'active']).is('first_look_status', null)
  if (error) console.error('first look pending mark failed:', error.message)
}

export async function storeFirstLook(phone: string, status: Exclude<FirstLookStatus, 'pending' | 'sent'>, text: string | null): Promise<void> {
  const { error } = await createServerClient().from('waitlist')
    .update({ first_look_status: status, first_look_text: status === 'ready' ? text : null, first_look_at: new Date().toISOString() })
    .eq('phone', phone).in('status', ['joined', 'invited', 'active'])
  if (error) console.error('first look store failed:', error.message)
}

/** Atomically take the stored text for delivery. Returns null when there is none or another worker took it. */
export async function claimFirstLook(phone: string): Promise<string | null> {
  const db = createServerClient()
  const { data: row, error } = await db.from('waitlist').select('id, first_look_text')
    .eq('phone', phone).eq('first_look_status', 'ready').not('first_look_text', 'is', null).limit(1).maybeSingle()
  if (error || !row?.first_look_text) return null
  const { data: claimed, error: claimErr } = await db.from('waitlist')
    .update({ first_look_status: 'sent', first_look_text: null, first_look_at: new Date().toISOString() })
    .eq('id', row.id).eq('first_look_status', 'ready').select('id')
  if (claimErr || !claimed?.length) return null
  return row.first_look_text as string
}
