import { createServerClient } from '@/lib/supabase/server'

/**
 * Look up (or lazily create) the Dinghy user row for a Telegram id.
 * Used by the connect flow, which runs outside the Telegram webhook and
 * therefore cannot reuse the orchestrator's message-scoped getOrCreateUser.
 */
export async function getOrCreateUserByTelegramId(telegramId: bigint): Promise<string | null> {
  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId.toString())
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('users')
    .insert({ telegram_id: telegramId.toString() })
    .select('id')
    .single()

  if (error || !created) return null
  return created.id as string
}
