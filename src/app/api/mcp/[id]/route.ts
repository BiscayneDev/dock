import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { refreshMCPTools } from '@/lib/mcp/client'

// Toggle or delete an MCP connection
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

  const updates = body as Record<string, unknown>
  const supabase = createServerClient()

  // If refresh is requested, re-discover tools
  if (updates.refresh) {
    try {
      const tools = await refreshMCPTools(id, session.userId)
      return NextResponse.json({
        refreshed: true,
        toolCount: tools.length,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refresh failed'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  const { error } = await supabase
    .from('mcp_connections')
    .update({ enabled: updates.enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', session.userId)

  if (error) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ updated: true })
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
    .from('mcp_connections')
    .delete()
    .eq('id', id)
    .eq('user_id', session.userId)

  if (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
