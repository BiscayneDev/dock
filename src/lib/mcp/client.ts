import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// MCP client that discovers and proxies tools from remote MCP servers
// Supports Streamable HTTP transport with SSE fallback
// Only uses the Tools capability (not Prompts, Resources, etc.)

interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface MCPConnection {
  id: string
  name: string
  serverUrl: string
  authType: 'none' | 'api_key' | 'oauth'
  authConfig: Record<string, unknown> | null
  discoveredTools: MCPToolDefinition[]
  enabled: boolean
}

interface MCPInitResponse {
  protocolVersion: string
  capabilities: { tools?: Record<string, unknown> }
  serverInfo: { name: string; version: string }
}

interface MCPToolsListResponse {
  tools: MCPToolDefinition[]
}

interface MCPToolCallResponse {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

// --- MCP HTTP Transport ---

async function mcpRequest(
  serverUrl: string,
  method: string,
  params: Record<string, unknown>,
  authHeaders: Record<string, string>,
  sessionId?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders,
  }

  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }

  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  }

  const response = await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  // Handle SSE response
  if (contentType.includes('text/event-stream')) {
    return parseSseResponse(response)
  }

  // Handle JSON response
  const json = (await response.json()) as { result?: unknown; error?: { message: string } }
  if (json.error) {
    throw new Error(`MCP error: ${json.error.message}`)
  }
  return json.result
}

async function parseSseResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  const lines = text.split('\n')

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim()
      if (data) {
        try {
          const parsed = JSON.parse(data) as { result?: unknown; error?: { message: string } }
          if (parsed.result) return parsed.result
          if (parsed.error) throw new Error(`MCP error: ${parsed.error.message}`)
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  }

  throw new Error('No valid response in SSE stream')
}

function buildAuthHeaders(connection: MCPConnection): Record<string, string> {
  if (connection.authType === 'api_key' && connection.authConfig) {
    const key = connection.authConfig.apiKey as string
    return { Authorization: `Bearer ${key}` }
  }
  if (connection.authType === 'oauth' && connection.authConfig) {
    const token = connection.authConfig.accessToken as string
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

// --- Discovery ---

export async function discoverTools(
  serverUrl: string,
  authType: string,
  authConfig: Record<string, unknown> | null
): Promise<MCPToolDefinition[]> {
  const connection: MCPConnection = {
    id: '',
    name: '',
    serverUrl,
    authType: authType as MCPConnection['authType'],
    authConfig,
    discoveredTools: [],
    enabled: true,
  }

  const authHeaders = buildAuthHeaders(connection)

  // Initialize session
  const initResult = (await mcpRequest(
    serverUrl, 'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'dock', version: '1.0.0' },
    },
    authHeaders
  )) as MCPInitResponse

  if (!initResult.capabilities.tools) {
    return []
  }

  // Send initialized notification
  await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  }).catch(() => {
    // Notification failures are non-critical
  })

  // List tools
  const toolsResult = (await mcpRequest(
    serverUrl, 'tools/list', {},
    authHeaders
  )) as MCPToolsListResponse

  return toolsResult.tools ?? []
}

// --- Tool Proxy ---

function createMCPProxyTool(
  connection: MCPConnection,
  mcpTool: MCPToolDefinition
): Tool {
  // Prefix tool name with connection name to avoid collisions
  const prefixedName = `mcp_${connection.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${mcpTool.name}`

  return {
    name: prefixedName,
    description: `[${connection.name}] ${mcpTool.description}`,
    inputSchema: mcpTool.inputSchema,
    async execute(input: unknown, _ctx: UserContext): Promise<ToolResult> {
      try {
        const authHeaders = buildAuthHeaders(connection)

        const result = (await mcpRequest(
          connection.serverUrl,
          'tools/call',
          { name: mcpTool.name, arguments: input },
          authHeaders
        )) as MCPToolCallResponse

        if (result.isError) {
          const errorText = result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')
          return { success: false, error: errorText || 'MCP tool execution failed' }
        }

        const outputText = result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')

        return { success: true, data: outputText }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('MCP tool call failed', {
          tool: mcpTool.name,
          server: connection.name,
          error: msg,
        })
        return { success: false, error: msg }
      }
    },
  }
}

// --- Load user's MCP tools ---

export async function loadMCPToolsForUser(userId: string): Promise<Tool[]> {
  const supabase = createServerClient()

  const { data: connections, error } = await supabase
    .from('mcp_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true)

  if (error || !connections || connections.length === 0) {
    return []
  }

  const tools: Tool[] = []

  for (const conn of connections) {
    const authConfig = conn.auth_config
      ? (() => {
          try {
            const decrypted = decryptTokenFromDb(conn.auth_config as string)
            return JSON.parse(decrypted) as Record<string, unknown>
          } catch {
            return null
          }
        })()
      : null

    const connection: MCPConnection = {
      id: conn.id as string,
      name: conn.name as string,
      serverUrl: conn.server_url as string,
      authType: (conn.auth_type as string) as MCPConnection['authType'],
      authConfig,
      discoveredTools: (conn.discovered_tools as MCPToolDefinition[]) ?? [],
      enabled: true,
    }

    // Use cached tool definitions to avoid re-discovery on every request
    for (const mcpTool of connection.discoveredTools) {
      tools.push(createMCPProxyTool(connection, mcpTool))
    }
  }

  return tools
}

// --- Store MCP connection ---

export async function storeMCPConnection(
  userId: string,
  name: string,
  serverUrl: string,
  authType: string,
  authConfig: Record<string, unknown> | null,
  discoveredTools: MCPToolDefinition[]
): Promise<string> {
  const supabase = createServerClient()

  const encryptedConfig = authConfig
    ? encryptTokenForDb(JSON.stringify(authConfig))
    : null

  const { data, error } = await supabase
    .from('mcp_connections')
    .insert({
      user_id: userId,
      name,
      server_url: serverUrl,
      auth_type: authType,
      auth_config: encryptedConfig,
      discovered_tools: discoveredTools,
      last_connected_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to store MCP connection: ${error?.message ?? 'Unknown error'}`)
  }

  return data.id as string
}

export async function refreshMCPTools(connectionId: string, userId: string): Promise<MCPToolDefinition[]> {
  const supabase = createServerClient()

  const { data: conn } = await supabase
    .from('mcp_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .single()

  if (!conn) throw new Error('Connection not found')

  const authConfig = conn.auth_config
    ? (() => {
        try {
          return JSON.parse(decryptTokenFromDb(conn.auth_config as string)) as Record<string, unknown>
        } catch {
          return null
        }
      })()
    : null

  const tools = await discoverTools(
    conn.server_url as string,
    conn.auth_type as string,
    authConfig
  )

  await supabase
    .from('mcp_connections')
    .update({
      discovered_tools: tools,
      last_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)

  return tools
}
