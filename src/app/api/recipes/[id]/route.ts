import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

const UpdateRecipeBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  instructions: z.string().min(1).optional(),
  trigger_type: z.enum(['schedule', 'email_event', 'github_event', 'notion_event', 'keyword', 'manual']).optional(),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  notify_on_run: z.boolean().optional(),
  fee_amount: z.number().min(0).max(100).optional(),
  fee_required: z.boolean().optional(),
  is_public: z.boolean().optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.userId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
  }

  return NextResponse.json({ recipe: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UpdateRecipeBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('recipes')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', session.userId)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update recipe' }, { status: 500 })
  }

  return NextResponse.json({ recipe: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', id)
    .eq('user_id', session.userId)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete recipe' }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
