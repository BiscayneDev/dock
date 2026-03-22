import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { buildRecipeServiceInfo } from '@/lib/x402/server'

// x402 service discovery endpoint
// Returns all public paid recipes as x402-compatible services.
// External AI agents can use this to discover what Dock recipes are available.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const category = searchParams.get('category')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 100)

  const supabase = createServerClient()

  let query = supabase
    .from('recipes')
    .select('id, name, description, fee_amount, fee_required, trigger_type, category, run_count')
    .eq('is_public', true)
    .eq('enabled', true)
    .order('run_count', { ascending: false })
    .limit(limit)

  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
  }

  if (category) {
    query = query.eq('category', category)
  }

  const { data: recipes, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 })
  }

  // Determine base URL from request
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get('host') ?? 'dock-six.vercel.app'}`

  const services = (recipes ?? []).map((recipe) =>
    buildRecipeServiceInfo(
      {
        id: recipe.id as string,
        name: recipe.name as string,
        description: recipe.description as string | null,
        fee_amount: recipe.fee_amount as number,
        fee_required: recipe.fee_required as boolean,
        trigger_type: recipe.trigger_type as string,
        category: recipe.category as string | null,
        run_count: recipe.run_count as number,
      },
      appUrl
    )
  )

  const response = NextResponse.json({
    protocol: 'x402',
    version: '1.0',
    provider: 'Dock',
    description: 'AI-powered automation recipes available via x402 protocol',
    services,
    total: services.length,
  })

  // CORS headers for cross-origin AI agent access
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Payment-Signature')

  return response
}

// Handle CORS preflight
export async function OPTIONS(): Promise<NextResponse> {
  const response = new NextResponse(null, { status: 204 })
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Payment-Signature, Payment-Required')
  return response
}
