import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { executeRecipe } from '@/lib/recipes/execution-agent'

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

  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.userId)
    .single()

  if (error || !recipe) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
  }

  // Fire-and-forget
  executeRecipe(
    {
      id: recipe.id as string,
      user_id: recipe.user_id as string,
      name: recipe.name as string,
      instructions: recipe.instructions as string,
      trigger_type: recipe.trigger_type as string,
      notify_on_run: recipe.notify_on_run as boolean,
      run_count: (recipe.run_count as number) ?? 0,
      fee_amount: (recipe.fee_amount as number) ?? 0,
      fee_required: (recipe.fee_required as boolean) ?? false,
    },
    { manual: true, source: 'harbor' }
  ).catch(() => {
    // Error handling is inside executeRecipe
  })

  return NextResponse.json({ message: 'Recipe triggered' })
}
