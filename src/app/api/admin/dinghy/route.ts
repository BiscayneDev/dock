import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminSession } from '@/lib/auth/admin'

interface ChatUsage {
  chat_guid: string
  handle: string | null
  calls: number
  tokens: number
  cost_usd: number
  last_used: string | null
}

export async function GET(): Promise<NextResponse> {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const supabase = createServerClient()
  const now = Date.now()
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Dinghy usage: metered inference rows keyed by chat (chat_guid not null).
  const [
    totalUsage,
    usage24h,
    usage7d,
    usage30d,
    perChatRows,
    waitlistRows,
  ] = await Promise.all([
    supabase.from('inference_usage').select('input_tokens, output_tokens, actual_cost_usd, latency_ms', { count: 'exact', head: true })
      .not('chat_guid', 'is', null),
    supabase.from('inference_usage').select('input_tokens, output_tokens, actual_cost_usd')
      .not('chat_guid', 'is', null).gte('created_at', since24h),
    supabase.from('inference_usage').select('input_tokens, output_tokens, actual_cost_usd')
      .not('chat_guid', 'is', null).gte('created_at', since7d),
    supabase.from('inference_usage').select('chat_guid, input_tokens, output_tokens, actual_cost_usd, created_at')
      .not('chat_guid', 'is', null).gte('created_at', since30d).order('created_at', { ascending: false }),
    supabase.from('spectrum_identities').select('chat_guid, handle'),
    supabase.from('waitlist').select('id, email, name, status, created_at, updated_at, dinghy_line, intro_texted_at').order('created_at', { ascending: false }).limit(200),
  ])

  // Beta invites + allowlist (invite activity, separate from signups)
  const [{ data: inviteRows }, { data: allowRows }] = await Promise.all([
    supabase.from('beta_invites').select('code_hash, note, max_uses, uses, created_at, expires_at, created_by_chat')
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('beta_allowlist').select('chat_guid, note, role, added_at')
      .order('added_at', { ascending: false }).limit(100),
  ])
  const invites = inviteRows ?? []
  const allowlist = allowRows ?? []
  const invites7d = invites.filter((i) => (i.created_at as string) >= since7d).length
  const allowAdded7d = allowlist.filter((a) => (a.added_at as string) >= since7d).length
  const redeemed = invites.reduce((acc, i) => acc + (i.uses as number ?? 0), 0)
  // Normalize allowlist guids for display (never show full numbers).
  const maskGuid = (g: string) => {
    const m = g.match(/(\d{2})\d+(\d{4})$/)
    return m ? `+${m[1]}••••${m[2]}` : g.slice(0, 10) + '…'
  }

  // Model breakdown needs actual rows (head:true gives only count) — cheap extra query.
  const { data: modelRows } = await supabase
    .from('inference_usage').select('model')
    .not('chat_guid', 'is', null)
    .gte('created_at', since30d)
  const byModel: Record<string, number> = {}
  for (const r of modelRows ?? []) {
    const m = (r.model as string) ?? 'unknown'
    byModel[m] = (byModel[m] ?? 0) + 1
  }

  // Aggregate 30d usage per chat, joined with identity handles.
  const handleByChat = new Map(
    (perChatRows.data ?? []).map((r) => [r.chat_guid as string, r.handle as string | null])
  )
  const chatMap = new Map<string, ChatUsage>()
  for (const r of usage30d.data ?? []) {
    const guid = r.chat_guid as string
    let entry = chatMap.get(guid)
    if (!entry) {
      entry = { chat_guid: guid, handle: handleByChat.get(guid) ?? null, calls: 0, tokens: 0, cost_usd: 0, last_used: null }
      chatMap.set(guid, entry)
    }
    entry.calls += 1
    entry.tokens += (r.input_tokens as number ?? 0) + (r.output_tokens as number ?? 0)
    entry.cost_usd += r.actual_cost_usd as number ?? 0
    if (!entry.last_used || (r.created_at as string) > entry.last_used) entry.last_used = r.created_at as string
  }
  const chats = [...chatMap.values()].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 25)

  const sum = (rows: Array<Record<string, unknown>>, k: string) =>
    (rows ?? []).reduce((acc, r) => acc + (r[k] as number ?? 0), 0)

  // Waitlist funnel
  const waitlist = waitlistRows.data ?? []
  const waitlistByStatus: Record<string, number> = { joined: 0, invited: 0, active: 0 }
  for (const w of waitlist) {
    const s = (w.status as string) in waitlistByStatus ? w.status as string : 'joined'
    waitlistByStatus[s] += 1
  }
  // Total count may exceed the 200-row page.
  const { count: waitlistTotal } = await supabase
    .from('waitlist').select('*', { count: 'exact', head: true })

  // Daily usage for last 14 days (chart-friendly)
  const { data: dailyRows } = await supabase
    .from('inference_usage').select('created_at, input_tokens, output_tokens, actual_cost_usd')
    .not('chat_guid', 'is', null).gte('created_at', new Date(now - 14 * 864e5).toISOString())
  const daily: Array<{ date: string; calls: number; tokens: number; cost_usd: number }> = []
  const dailyMap = new Map<string, { calls: number; tokens: number; cost_usd: number }>()
  for (const r of dailyRows ?? []) {
    const d = (r.created_at as string).slice(0, 10)
    const e = dailyMap.get(d) ?? { calls: 0, tokens: 0, cost_usd: 0 }
    e.calls += 1
    e.tokens += (r.input_tokens as number ?? 0) + (r.output_tokens as number ?? 0)
    e.cost_usd += r.actual_cost_usd as number ?? 0
    dailyMap.set(d, e)
  }
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 864e5).toISOString().slice(0, 10)
    const e = dailyMap.get(d) ?? { calls: 0, tokens: 0, cost_usd: 0 }
    daily.push({ date: d, ...e })
  }

  return NextResponse.json({
    usage: {
      totalCalls: totalUsage.count ?? 0,
      calls24h: (usage24h.data ?? []).length,
      tokens24h: sum(usage24h.data as Array<Record<string, unknown>>, 'input_tokens') + sum(usage24h.data as Array<Record<string, unknown>>, 'output_tokens'),
      cost24h: sum(usage24h.data as Array<Record<string, unknown>>, 'actual_cost_usd'),
      calls7d: (usage7d.data ?? []).length,
      tokens7d: sum(usage7d.data as Array<Record<string, unknown>>, 'input_tokens') + sum(usage7d.data as Array<Record<string, unknown>>, 'output_tokens'),
      cost7d: sum(usage7d.data as Array<Record<string, unknown>>, 'actual_cost_usd'),
      calls30d: (usage30d.data ?? []).length,
      cost30d: sum(usage30d.data as Array<Record<string, unknown>>, 'actual_cost_usd'),
      byModel,
    },
    chats,
    daily,
    waitlist: {
      total: waitlistTotal ?? waitlist.length,
      byStatus: waitlistByStatus,
      recent: waitlist.slice(0, 50),
    },
    invites: {
      total: invites.length,
      invites7d,
      redeemed,
      recent: invites.slice(0, 20).map((i) => ({
        note: (i.note as string) ?? null,
        uses: i.uses as number,
        max_uses: i.max_uses as number,
        created_at: i.created_at as string,
        expires_at: i.expires_at as string,
      })),
      allowlist: {
        total: allowlist.length,
        added7d: allowAdded7d,
        recent: allowlist.slice(0, 20).map((a) => ({
          chat: maskGuid(a.chat_guid as string),
          note: (a.note as string) ?? null,
          role: (a.role as string) ?? 'member',
          added_at: a.added_at as string,
        })),
      },
    },
  })
}
