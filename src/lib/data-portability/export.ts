import { createServerClient } from '@/lib/supabase/server'
import { deflateRawSync } from 'node:zlib'

export type ExportRow = Record<string, unknown>
export interface ExportSection { table: string; columns: string; scope: 'user' | 'chat'; key: string }
// Explicit columns, never select('*'). Credential stores and arbitrary tool
// argument/result blobs are deliberately excluded.
export const EXPORT_SECTIONS: ExportSection[] = [
  ['users', 'id,name,telegram_id,telegram_username,timezone,quiet_hours_start,quiet_hours_end,daily_briefing,preferences,created_at', 'user', 'id'],
  ['oauth_tokens', 'id,provider,provider_account_id,provider_account_email,scopes,created_at,updated_at', 'user', 'id'],
  ['dinghy_user_profiles', 'user_id,profile,updated_at', 'user', 'user_id'],
  ['memories', 'id,type,content,valid_from,superseded_at,created_at', 'user', 'id'],
  ['messages', 'id,role,content,created_at', 'user', 'id'],
  ['dinghy_plans', 'id,title,kind,starts_on,ends_on,places,people,details,source,created_at,updated_at,deleted_at', 'user', 'id'],
  ['dinghy_files', 'id,title,format,kind,markdown,expires_at,created_at,deleted_at,revoked_at', 'user', 'id'],
  ['reminders', 'id,message,fire_at,fired,created_at', 'user', 'id'],
  ['recipes', 'id,name,description,instructions,trigger_type,enabled,notify_on_run,created_at,updated_at', 'user', 'id'],
  ['recipe_runs', 'id,recipe_id,triggered_at,completed_at,status,output,duration_ms', 'user', 'id'],
  ['user_capabilities', 'id,kind,label,scope,mode,created_at,expires_at,last_used_at,revoked_at', 'user', 'id'],
  ['capability_runs', 'id,kind,label,mode,task,started_at,ended_at,outcome', 'user', 'id'],
  ['mcp_connections', 'id,name,auth_type,enabled,created_at,updated_at', 'user', 'id'],
  ['briefing_settings', 'user_id,enabled,muted,home_place,updated_at', 'user', 'user_id'],
  ['user_locations', 'user_id,lat,lon,label,source,observed_at', 'user', 'user_id'],
  ['spend_limits', 'user_id,daily_usd,updated_at', 'user', 'user_id'],
  ['computer_settings', 'user_id,enabled,free_seconds_per_day,hard_cap_usd_per_day,daily_allowance_usd,allowance_timezone,created_at', 'user', 'user_id'],
  ['spend_events', 'id,source,amount_usd,currency,memo,created_at', 'user', 'id'],
  ['inference_settlements', 'id,status,owed_usd,atomic_usdc,network,signature,created_at,settled_at', 'user', 'id'],
  ['inference_usage', 'id,model,input_tokens,output_tokens,actual_cost_usd,latency_ms,created_at', 'user', 'id'],
  ['spectrum_messages', 'id,chat_guid,role,content,created_at', 'chat', 'id'],
  ['dinghy_profiles', 'chat_guid,profile,updated_at', 'chat', 'chat_guid'],
  ['conversation_summaries', 'id,chat_guid,summary,message_count,first_at,last_at,created_at', 'chat', 'id'],
  ['memories', 'id,type,content,valid_from,superseded_at,created_at', 'chat', 'id'],
  ['reminders', 'id,message,fire_at,fired,created_at', 'chat', 'id'],
  ['inference_usage', 'id,model,input_tokens,output_tokens,actual_cost_usd,latency_ms,created_at', 'chat', 'id'],
].map(([table, columns, scope, key]) => ({ table, columns, scope, key })) as ExportSection[]

export function isDataExportIntent(text: string): boolean {
  return /^(?:please\s+)?(?:export|download) (?:all )?my data[.!?]*$/i.test(text.trim()) || text.trim().toLowerCase() === '/export'
}

const SECRET_KEY = /(?:token|password|passwd|secret|cookie|authorization|api.?key|signing.?key|private.?key|pkce|code.?hash|session.?id)/i
export function redactExport(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:pbxk1|sk_live_|sk_test_|sk-proj-|ghp_|github_pat_|AIza)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, '[redacted credential]')
  if (Array.isArray(value)) return value.map(redactExport)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, v]) => [key, redactExport(v)]))
  return value
}

const PAGE = 500
const MAX_BYTES = 12 * 1024 * 1024
async function readRows(db: ReturnType<typeof createServerClient>, section: ExportSection, owner: string): Promise<ExportRow[]> {
  const rows: ExportRow[] = []
  let last: unknown = null
  for (;;) {
    const ownerColumn = section.scope === 'chat' ? 'chat_guid' : section.table === 'users' ? 'id' : 'user_id'
    let query = db.from(section.table).select(section.columns).eq(ownerColumn, owner).order(section.key).limit(PAGE)
    if (last !== null) query = query.gt(section.key, last)
    const { data, error } = await query
    if (error) throw new Error(`Export read failed: ${section.table}`)
    const page = (data ?? []) as ExportRow[]
    rows.push(...page)
    if (Buffer.byteLength(JSON.stringify(rows)) > MAX_BYTES) throw new Error('Export too large for chat delivery')
    if (page.length < PAGE) return rows
    const next = page[page.length - 1][section.key]
    if (next === undefined || next === last) throw new Error('Export pagination failed')
    last = next
  }
}

export async function collectExport(chatGuid: string, db = createServerClient()): Promise<Record<string, ExportRow[]>> {
  const identity = await db.from('spectrum_identities').select('user_id').eq('chat_guid', chatGuid).maybeSingle()
  if (identity.error) throw new Error('Export identity unavailable')
  const userId = identity.data?.user_id as string | undefined
  let chats = [chatGuid]
  if (userId) {
    const links = await db.from('spectrum_identities').select('chat_guid').eq('user_id', userId).limit(PAGE)
    if (links.error || (links.data?.length ?? 0) >= PAGE) throw new Error('Export chat scope unavailable')
    chats = [...new Set([chatGuid, ...(links.data ?? []).map(r => r.chat_guid as string)])]
  }
  const result: Record<string, ExportRow[]> = {}
  for (const section of EXPORT_SECTIONS) {
    const owners = section.scope === 'chat' ? chats : userId ? [userId] : []
    for (const owner of owners) {
      const rows = await readRows(db, section, owner)
      const existing = result[section.table] ?? []
      const keys = new Set(existing.map(r => r[section.key]))
      result[section.table] = [...existing, ...rows.filter(r => !keys.has(r[section.key]))]
    }
  }
  return redactExport(result) as Record<string, ExportRow[]>
}

const README = `# Your Dinghy data\n\nJSON files are plain UTF-8 text, readable without Dinghy. Saved page/document bodies are also in files/ as Markdown.\n\nThis export contains the available account profile, preferences, fact versions (including superseded facts), chat summaries/history, plans, files, reminders, recipes, workflow/capability metadata, connected account metadata, location, and usage/spend records. Guest chats contain only that chat's records. Each table is paginated; a read error fails the export instead of silently skipping it. Reads are not a transaction snapshot, so records added during export may appear.\n\nExcluded: credentials, access/refresh/signing tokens, auth cookies, embeddings, login/connect codes, raw tool arguments/results, arbitrary execution-agent logs, pending action payloads, provider browser/sandbox files, original incoming attachments, temporary delivery queues, and operator waitlist/admission records. Known credential patterns in free text are redacted; do not share this archive publicly. A secret pasted into prose in an unrecognized format cannot be reliably identified. Binary originals and expired hosted links are not recovered; saved Markdown is portable. Connected providers retain their own data.\n\nThis export does not delete anything. The older 'forget everything' command only clears remembered facts and plans, not the account or chat history. Full account erasure is not yet available in this release.\n`

export function exportEntries(data: Record<string, ExportRow[]>, createdAt = new Date().toISOString()): { name: string; bytes: Buffer }[] {
  const entries = [{ name: 'README.md', bytes: Buffer.from(README) }, { name: 'manifest.json', bytes: Buffer.from(JSON.stringify({ version: 1, created_at: createdAt, counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) }, null, 2)) }]
  for (const [table, rows] of Object.entries(data)) entries.push({ name: `${table}.json`, bytes: Buffer.from(JSON.stringify(rows, null, 2)) })
  for (const [index, file] of (data.dinghy_files ?? []).entries()) entries.push({ name: `files/${String(index + 1).padStart(5, '0')}.md`, bytes: Buffer.from(`# ${String(file.title ?? 'File')}\n\n${String(file.markdown ?? '')}`) })
  if (entries.reduce((n, e) => n + e.bytes.length, 0) > MAX_BYTES) throw new Error('Export too large for chat delivery')
  return entries
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
// ZIP with deflate and UTF-8 names. Fixed paths, no titles as filesystem paths.
export function zipExport(entries: ReturnType<typeof exportEntries>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_/-]+\.(?:md|json)$/.test(entry.name) || entry.name.includes('..')) throw new Error('Unsafe export path')
    const name = Buffer.from(entry.name), compressed = deflateRawSync(entry.bytes), crc = crc32(entry.bytes)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(entry.bytes.length, 22); header.writeUInt16LE(name.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(entry.bytes.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42)
    local.push(header, name, compressed); central.push(c, name); offset += header.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

export async function makeDataExport(chatGuid: string): Promise<{ filename: string; bytes: Buffer }> {
  const data = await collectExport(chatGuid)
  return { filename: 'dinghy-data.zip', bytes: zipExport(exportEntries(data)) }
}

export async function canDeliverDataExport(chatGuid: string, handle: string | null): Promise<boolean> {
  if (process.env.DINGHY_DATA_EXPORT_ENABLED !== '1' || !handle) return false
  const { data, error } = await createServerClient().from('spectrum_identities')
    .select('handle').eq('chat_guid', chatGuid).maybeSingle()
  return !error && Boolean(data?.handle) && data.handle === handle
}
