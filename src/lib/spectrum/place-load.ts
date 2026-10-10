import { createServerClient } from '@/lib/supabase/server'
import { latestStatement, PIN_FRESH_MS, type StatedMessage } from './place'

/** Recent user lines for this chat, newest first, inside the statement window. */
export async function recentUserLines(chatGuid: string, now = Date.now()): Promise<StatedMessage[]> {
  const since = new Date(now - 36 * 60 * 60 * 1000).toISOString()
  const { data } = await createServerClient()
    .from('spectrum_messages')
    .select('content, created_at')
    .eq('chat_guid', chatGuid)
    .eq('role', 'user')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(40)
  return (data ?? []) as StatedMessage[]
}

export async function currentStatement(chatGuid: string, now = Date.now()) {
  return latestStatement(await recentUserLines(chatGuid, now), now)
}

export async function freshPin(userId: string, now = Date.now()): Promise<{ lat: number; lon: number; label: string | null; observedAt: number } | null> {
  const { data } = await createServerClient().from('user_locations').select('lat, lon, label, observed_at').eq('user_id', userId).maybeSingle()
  if (!data) return null
  const observedAt = Date.parse(data.observed_at as string)
  if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt >= PIN_FRESH_MS) return null
  return { lat: Number(data.lat), lon: Number(data.lon), label: (data.label as string | null) ?? null, observedAt }
}
