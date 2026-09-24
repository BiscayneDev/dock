/**
 * Which Dinghy number a chat is talking to.
 *
 * On Photon's shared pool each user is routed through their own assigned line,
 * so anything that shows "Dinghy's number" (the contact card) has to use that
 * person's line - a card with someone else's line bounces when they text it.
 *
 * Order: waitlist.dinghy_line (set at approve time) -> Photon users API
 * (create is idempotent on phoneNumber and returns the existing assignment;
 * only registered users can reach us, so this never creates a stranger) ->
 * the owner line as a last resort.
 */
import { createServerClient } from '@/lib/supabase/server'
import { DINGHY_PHONE } from './contact-card'
import { registerPhotonUser } from './photon-users'

/** "any;-;+16784680733" -> "+16784680733"; null for emails and group chats. */
export function phoneFromChatGuid(chatGuid: string): string | null {
  const handle = chatGuid.split(';').pop() ?? ''
  return /^\+[1-9]\d{7,14}$/.test(handle) ? handle : null
}

export async function dinghyLineFor(chatGuid: string): Promise<string> {
  const phone = phoneFromChatGuid(chatGuid)
  if (!phone) return DINGHY_PHONE
  try {
    const { data } = await createServerClient()
      .from('waitlist').select('dinghy_line').eq('phone', phone).not('dinghy_line', 'is', null).limit(1).maybeSingle()
    const line = (data as { dinghy_line?: string } | null)?.dinghy_line
    if (line) return line
  } catch { /* fall through */ }
  const user = await registerPhotonUser(phone)
  return user?.assignedPhoneNumber ?? DINGHY_PHONE
}
