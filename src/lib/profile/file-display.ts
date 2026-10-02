export type FileKind = 'file' | 'itinerary'
export type FileSummary = { id: string; title: string; format: string; kind: FileKind; url: string | null; expires_at: string | null; created_at: string; revoked_at: string | null }
export function safeFileUrl(url: string | null): string | null {
  if (!url) return null
  try { const u = new URL(url); return u.protocol === 'https:' ? u.href : null } catch { return null }
}
export function fileLinkState(f: Pick<FileSummary, 'url' | 'expires_at' | 'revoked_at'>, now = Date.now()): 'live' | 'expired' | 'revoked' | 'private' {
  if (f.revoked_at) return 'revoked'
  if (f.expires_at && (!Number.isFinite(Date.parse(f.expires_at)) || Date.parse(f.expires_at) <= now)) return 'expired'
  return safeFileUrl(f.url) ? 'live' : 'private'
}
