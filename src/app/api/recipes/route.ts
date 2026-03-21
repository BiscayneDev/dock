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
