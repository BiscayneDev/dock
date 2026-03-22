import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

// Fork a public recipe into the current user's account
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServerClient()

  // Fetch the source recipe — must be public
  const { data: source, error: fetchError } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .eq('is_public', true)
    .single()

  if (fetchError || !source) {
    return NextResponse.json({ error: 'Recipe not found or not public' }, { status: 404 })
  }

  // Don't fork your own recipe
  if (source.user_id === session.userId) {
    return NextResponse.json({ error: 'You already own this recipe' }, { status: 400 })
  }

  // Create the fork — private, no fee, disabled by default
  const { data: fork, error: insertError } = await supabase
    .from('recipes')
    .insert({
      user_id: session.userId,
      name: source.name as string,
      description: source.description as string | null,
      instructions: source.instructions as string,
      trigger_type: source.trigger_type as string,
      trigger_config: source.trigger_config,
      category: source.category as string | null,
      enabled: false,
      notify_on_run: true,
      fee_amount: 0,
      fee_required: false,
      is_public: false,
      forked_from: id,
    })
    .select('id')
    .single()

  if (insertError || !fork) {
    return NextResponse.json({ error: 'Failed to fork recipe' }, { status: 500 })
  }

  // Increment fork count on the source recipe
  await supabase
    .from('recipes')
    .update({ fork_count: ((source.fork_count as number) ?? 0) + 1 })
    .eq('id', id)

  return NextResponse.json({
    recipe: fork,
    editUrl: `/dashboard/recipes/${fork.id}/edit`,
  }, { status: 201 })
}
