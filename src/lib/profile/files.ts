import { createServerClient } from '@/lib/supabase/server'
import { safeFileUrl, type FileSummary } from './file-display'
export { safeFileUrl, fileLinkState } from './file-display'
export async function listFiles(userId: string, page = 0): Promise<{ files: FileSummary[]; more: boolean }> {
  const start = Math.min(Math.max(page, 0), 100) * 6
  const { data, error } = await createServerClient().from('dinghy_files')
    .select('id,title,format,kind,url,expires_at,created_at,revoked_at')
    .eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 6)
  if (error) throw new Error('Files unavailable')
  const rows = (data ?? []) as FileSummary[]
  return { files: rows.slice(0, 6).map(f => ({ ...f, url: safeFileUrl(f.url) })), more: rows.length > 6 }
}
export async function getFile(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data, error } = await createServerClient().from('dinghy_files')
    .select('id,title,format,kind,url,markdown,expires_at,created_at,revoked_at')
    .eq('user_id', userId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) throw new Error('File unavailable')
  return data as (FileSummary & { markdown: string }) | null
}
