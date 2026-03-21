import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

const CreateRecipeBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().min(1),
  trigger_type: z.enum(['schedule', 'email_event', 'github_event', 'notion_event', 'keyword', 'manual']),
  trigger_config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional().default(true),
  notify_on_run: z.boolean().optional().default(true),
  fee_amount: z.number().min(0).max(100).optional().default(0),
  fee_required: z.boolean().optional().default(false),
  is_public: z.boolean().optional().default(false),
})

export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch recipes' }, { status: 500 })
  }

  return NextResponse.json({ recipes: data })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateRecipeBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const supabase = createServerClient()

  // If setting a fee, verify the user has a wallet to receive payments
  if (parsed.data.fee_required && parsed.data.fee_amount > 0) {
    const { data: user } = await supabase
      .from('users')
      .select('wallet_address')
      .eq('id', session.userId)
      .single()

    if (!user?.wallet_address) {
      return NextResponse.json(
        { error: 'Connect a wallet before creating paid recipes' },
        { status: 400 }
      )
    }
  }

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id: session.userId,
      ...parsed.data,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 })
  }

  return NextResponse.json({ recipe: data }, { status: 201 })
}
