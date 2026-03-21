import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { discoverTools, storeMCPConnection } from '@/lib/mcp/client'

const CreateMCPBody = z.object({
  name: z.string().min(1),
  serverUrl: z.string().url(),
  authType: z.enum(['none', 'api_key', 'oauth']).default('none'),
  authConfig: z.record(z.string(), z.unknown()).optional(),
})

// List user's MCP connections
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('mcp_connections')
    .select('id, name, server_url, auth_type, enabled, discovered_tools, last_connected_at, created_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 })
  }

  // Map discovered_tools to just count for the list view
  const connections = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    serverUrl: c.server_url,
    authType: c.auth_type,
    enabled: c.enabled,
    toolCount: Array.isArray(c.discovered_tools) ? (c.discovered_tools as unknown[]).length : 0,
    tools: c.discovered_tools,
    lastConnectedAt: c.last_connected_at,
  }))

  return NextResponse.json({ connections })
}

// Add a new MCP server connection
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

  const parsed = CreateMCPBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  // Discover tools from the server
  let tools
  try {
    tools = await discoverTools(
      parsed.data.serverUrl,
      parsed.data.authType,
      parsed.data.authConfig ?? null
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return NextResponse.json(
      { error: `Could not connect to MCP server: ${message}` },
      { status: 400 }
    )
  }

  try {
    const id = await storeMCPConnection(
      session.userId,
      parsed.data.name,
      parsed.data.serverUrl,
      parsed.data.authType,
      parsed.data.authConfig ?? null,
      tools
    )

    return NextResponse.json({
      id,
      name: parsed.data.name,
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
