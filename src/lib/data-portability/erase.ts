import { createHash, randomBytes } from 'node:crypto'
import { createServerClient } from '@/lib/supabase/server'
import { decryptTokenFromDb } from '@/lib/crypto'
import { revokeGoogleToken } from '@/lib/integrations/revoke'
import { listOwnedSites, revokeOwnedSite } from '@/lib/files/share'
import { sandboxOwnerTag } from './owner-tag'
import { erasureEnabled } from './erasure-state'

export { ERASE_WARNING } from './erasure-copy'

export function confirmPhrase(text: string): boolean { return text === 'DELETE MY DATA' }
export function hashEraseToken(token: string): string { return createHash('sha256').update(token).digest('hex') }
export async function requestErase(userId: string): Promise<{ id: string; token: string }> {
  if (!erasureEnabled()) throw new Error('Data deletion is not enabled')
  const token = randomBytes(32).toString('base64url')
  const { data, error } = await createServerClient().rpc('dinghy_erasure_request', { p_user_id: userId, p_hash: hashEraseToken(token) })
  if (error || typeof data !== 'string') throw new Error('Could not start deletion')
  return { id: data, token }
}
export async function confirmErase(userId: string, id: string, token: string, phrase: string): Promise<boolean> {
  if (!erasureEnabled() || !confirmPhrase(phrase) || !/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  const { data, error } = await createServerClient().rpc('dinghy_erasure_confirm', { p_user_id: userId, p_job: id, p_hash: hashEraseToken(token) })
  if (error) throw new Error('Could not confirm deletion')
  return data === true
}
export interface ErasureJob { id: string; user_id: string; chats: string[] }
export interface CleanupOps {
  revokeTokens(job: ErasureJob): Promise<string[]>
  killSandboxes(job: ErasureJob): Promise<void>
  removePages(job: ErasureJob): Promise<void>
  removeStorage(job: ErasureJob): Promise<void>
  finish(job: ErasureJob, notes: string[]): Promise<void>
}
export async function executeErasure(job: ErasureJob, ops: CleanupOps): Promise<string[]> {
  // Keep source pointers until every external operation has succeeded. Every
  // operation must be idempotent; partial progress is retried, never success.
  const notes = await ops.revokeTokens(job)
  await ops.killSandboxes(job)
  await ops.removePages(job)
  await ops.removeStorage(job)
  await ops.finish(job,notes)
  return notes
}
async function allRows(table: string, columns: string, userId: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  // Offset is safe here because these rows are frozen, not deleted until finish.
  for (let start = 0;; start += 500) {
    const { data, error } = await createServerClient().from(table).select(columns).eq('user_id', userId).order('id').range(start,start+499)
    if (error) throw new Error('External cleanup inventory unavailable')
    rows.push(...(data ?? []))
    if ((data?.length ?? 0)<500) return rows
  }
}
export function cleanupOps(): CleanupOps {
  const db = createServerClient()
  return {
    async revokeTokens(j) {
      const notes: string[] = []
      for (const row of await allRows('oauth_tokens','id,provider,refresh_token,access_token',j.user_id)) {
        const provider = String(row.provider)
        if (provider==='google' || provider.startsWith('google:')) {
          const encrypted = (row.refresh_token || row.access_token) as string | undefined
          const token = encrypted ? decryptTokenFromDb(encrypted) : null
          if (await revokeGoogleToken(token)!=='revoked') throw new Error('provider_revoke_failed')
        } else notes.push(`${provider}: local credentials removed; provider consent not revoked`)
      }
      return [...new Set(notes)]
    },
    async killSandboxes(j) {
      const sessions = await allRows('computer_sessions','id,sandbox_id',j.user_id)
      // Connect attempts have token_hash rather than id; separate stable scan.
      const { data, error } = await db.from('capability_connect_attempts').select('params').eq('user_id',j.user_id).limit(1000)
      if (error || (data?.length ?? 0)>=1000) throw new Error('login_sandbox_inventory_failed')
      const ids = new Set(sessions.map(s => s.sandbox_id).filter((s): s is string => typeof s==='string'))
      for (const row of data ?? []) if (typeof row.params?.sandbox_id==='string') ids.add(row.params.sandbox_id)
      if (!process.env.E2B_API_KEY) {
        if(ids.size) throw new Error('sandbox_credentials_unavailable')
        return
      }
      const { Sandbox } = await import('e2b')
      async function listed():Promise<string[]> {
        const p=Sandbox.list({query:{metadata:{dinghy_owner:sandboxOwnerTag(j.user_id)},state:['running','paused']}})
        const found:string[]=[]
        while(p.hasNext) {
          for(const row of await p.nextItems()) {
            if(row.metadata?.dinghy_owner!==sandboxOwnerTag(j.user_id)) throw new Error('sandbox_owner_mismatch')
            found.push(row.sandboxId)
          }
        }
        return found
      }
      for(const id of await listed())ids.add(id)
      for(const id of ids)await Sandbox.kill(id)
      if((await listed()).length)throw new Error('sandbox_cleanup_unverified')
    },
    async removePages(j) {
      const sites=await listOwnedSites(j.user_id)
      for(const link of sites)await revokeOwnedSite(link,j.user_id)
      if((await listOwnedSites(j.user_id)).length)throw new Error('hosted_delete_unverified')
    },
    async removeStorage(j) {
      const bucket = db.storage.from('dinghy-files')
      async function clear(prefix: string): Promise<void> {
        for (;;) {
          const { data, error } = await bucket.list(prefix,{limit:100,sortBy:{column:'name',order:'asc'}})
          if (error) throw new Error('storage_inventory_failed')
          if (!data?.length) return
          const paths: string[] = []
          for (const item of data) {
            if (item.name==='.' || item.name==='..' || item.name.includes('/')) throw new Error('storage_path_invalid')
            const path = `${prefix}/${item.name}`
            if (!item.id) await clear(path); else paths.push(path)
          }
          if (paths.length) {
            const removed = await bucket.remove(paths)
            if (removed.error) throw new Error('storage_cleanup_failed')
          }
          // Empty virtual folders disappear. No offset while deleting.
        }
      }
      await clear(j.user_id)
    },
    async finish(j,notes) {
      const saved=await db.from('dinghy_erasure_jobs').update({provider_notes:notes}).eq('id',j.id)
      if(saved.error) throw new Error('deletion_status_unavailable')
      const { data, error } = await db.rpc('dinghy_erasure_finish',{p_job:j.id})
      if (error || data!==true) throw new Error('database_cleanup_failed')
    },
  }
}

export async function processErasure(): Promise<'off'|'idle'|'complete'|'blocked'> {
  if (!erasureEnabled()) return 'off'
  // Activation requires an independently verified hosted-object inventory.
  if (process.env.DINGHY_ERASURE_LEGACY_SANDBOX_INVENTORY_VERIFIED !== '1') return 'blocked'
  const db=createServerClient()
  const { data, error }=await db.rpc('dinghy_erasure_claim')
  if (error) throw new Error('Deletion queue unavailable')
  if (!data) return 'idle'
  const job=data as ErasureJob
  if (!/^[0-9a-f-]{36}$/i.test(job.id) || !/^[0-9a-f-]{36}$/i.test(job.user_id) || !Array.isArray(job.chats)) throw new Error('Invalid deletion job')
  try {
    await executeErasure(job,cleanupOps())
    return 'complete'
  } catch (err) {
    const allowed=new Set(['provider_revoke_failed','login_sandbox_inventory_failed','sandbox_cleanup_failed','hosted_inventory_unverified','storage_inventory_failed','storage_cleanup_failed','database_cleanup_failed'])
    const tag=err instanceof Error && allowed.has(err.message) ? err.message : 'cleanup_failed'
    await db.from('dinghy_erasure_jobs').update({status:'blocked',obstacle:tag,lease_until:new Date(Date.now()+3600_000).toISOString()}).eq('id',job.id)
    return 'blocked'
  }
}
