import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

function inferRequiredIntegrations(triggerType: string, instructions: string): string[] {
  const integrations: Set<string> = new Set()
  const lower = instructions.toLowerCase()

  // Infer from trigger type
  if (triggerType === 'email_event' || triggerType === 'schedule') integrations.add('google')
  if (triggerType === 'github_event') integrations.add('github')
  if (triggerType === 'notion_event') integrations.add('notion')

  // Infer from instructions keywords
  if (lower.includes('email') || lower.includes('gmail') || lower.includes('inbox') || lower.includes('calendar') || lower.includes('gcal') || lower.includes('meeting')) integrations.add('google')
  if (lower.includes('github') || lower.includes('pull request') || lower.includes('issue') || lower.includes('repo')) integrations.add('github')
  if (lower.includes('notion') || lower.includes('database') || lower.includes('page')) integrations.add('notion')
  if (lower.includes('wallet') || lower.includes('crypto') || lower.includes('usdc') || lower.includes('balance') || lower.includes('transaction')) integrations.add('openwallet')

  return [...integrations]
}

// List public recipes — no auth required for browsing
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const category = searchParams.get('category')
  const pricing = searchParams.get('pricing') // 'free' | 'paid' | null
  const sort = searchParams.get('sort') ?? 'popular' // 'popular' | 'newest' | 'most_forked'
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 50)
  const offset = Number(searchParams.get('offset') ?? '0')

  const supabase = createServerClient()

  let query = supabase
    .from('recipes')
    .select('id, name, description, instructions, trigger_type, category, fee_amount, fee_required, run_count, fork_count, user_id, created_at, users!inner(name, telegram_username)')
    .eq('is_public', true)
    .eq('enabled', true)

  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
  }

  if (category) {
    query = query.eq('category', category)
  }

  if (pricing === 'free') {
    query = query.or('fee_required.eq.false,fee_amount.eq.0')
  } else if (pricing === 'paid') {
    query = query.eq('fee_required', true).gt('fee_amount', 0)
  }

  if (sort === 'newest') {
    query = query.order('created_at', { ascending: false })
  } else if (sort === 'most_forked') {
    query = query.order('fork_count', { ascending: false })
  } else {
    query = query.order('run_count', { ascending: false })
  }

  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch recipes' }, { status: 500 })
  }

  const recipes = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: (r.instructions as string).slice(0, 200),
    trigger_type: r.trigger_type,
    category: r.category,
    fee_amount: r.fee_amount,
    fee_required: r.fee_required,
    run_count: r.run_count,
    fork_count: r.fork_count,
    required_integrations: inferRequiredIntegrations(r.trigger_type as string, r.instructions as string),
    creator: {
      name: (r.users as unknown as { name: string | null })?.name ?? 'Anonymous',
      username: (r.users as unknown as { telegram_username: string | null })?.telegram_username,
    },
    created_at: r.created_at,
  }))

  return NextResponse.json({ recipes })
}
