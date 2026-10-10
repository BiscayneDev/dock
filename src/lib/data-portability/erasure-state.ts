import { createServerClient } from '@/lib/supabase/server'

export function erasureEnabled(): boolean { return process.env.DINGHY_DATA_ERASURE_ENABLED === '1' }
export function isEraseIntent(text: string): boolean {
  return /^(?:please )?(?:delete everything(?: about me)?|delete (?:all )?my data|erase my data)[.!?]*$/i.test(text.trim())
}
// Fails CLOSED when enabled. Disabled rollout does not add a DB dependency.
export async function assertAccountActive(userId?: string, chatGuid?: string): Promise<void> {
  if (!erasureEnabled()) return
  const { data, error } = await createServerClient().rpc('dinghy_erasure_blocked', {
    p_user_id: userId || null, p_chat_guid: chatGuid || null,
  })
  if (error || data !== false) throw new Error('Account unavailable during data deletion')
}

export async function assertTelegramActive(telegramId:string):Promise<void> {
  if(!erasureEnabled())return
  const {data,error}=await createServerClient().rpc('dinghy_erasure_telegram_blocked',{p_telegram_id:telegramId})
  if(error || data!==false)throw new Error('Account unavailable during data deletion')
}
