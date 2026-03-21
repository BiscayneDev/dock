import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { RECIPE_TEMPLATES } from '@/lib/recipes/templates'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  const template = RECIPE_TEMPLATES.find((t) => t.slug === slug)

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id: session.userId,
      name: template.name,
      description: template.description,
      instructions: template.instructions,
      trigger_type: template.triggerType,
      trigger_config: template.triggerConfig,
      enabled: false,
      notify_on_run: true,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to install template' }, { status: 500 })
  }

  // Check if trigger config needs user input (empty required fields)
  const needsConfig = hasEmptyRequiredFields(template.triggerConfig)

  return NextResponse.json({
    recipe: data,
    needsConfig,
    editUrl: `/dashboard/recipes/${data.id}/edit`,
  })
}

function hasEmptyRequiredFields(config: Record<string, unknown>): boolean {
  for (const value of Object.values(config)) {
    if (value === '' || value === null) return true
  }
  return false
}
