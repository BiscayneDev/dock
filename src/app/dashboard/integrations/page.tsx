'use client'

import { useCallback, useEffect, useState } from 'react'
import { NavBar } from '@/components/NavBar'

interface MCPConnection {
  id: string
  name: string
  serverUrl: string
  authType: string
  enabled: boolean
  toolCount: number
  tools: Array<{ name: string; description: string }>
  lastConnectedAt: string | null
}

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<MCPConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    name: '',
    serverUrl: '',
    authType: 'none' as 'none' | 'api_key' | 'oauth',
    apiKey: '',
  })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setConnections(data.connections ?? [])
      }
    } catch {
      // Failed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  const addConnection = async () => {
    setAdding(true)
    setError(null)

    const authConfig = form.authType === 'api_key'
      ? { apiKey: form.apiKey }
      : undefined

    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          serverUrl: form.serverUrl,
          authType: form.authType,
          authConfig,
        }),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to connect')
        return
      }

      setShowAdd(false)
      setForm({ name: '', serverUrl: '', authType: 'none', apiKey: '' })
      await loadConnections()
    } catch {
      setError('Connection failed')
    } finally {
      setAdding(false)
    }
  }

  const toggleConnection = async (id: string, enabled: boolean) => {
    await fetch(`/api/mcp/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
      credentials: 'include',
    })
    setConnections(connections.map((c) => c.id === id ? { ...c, enabled } : c))
  }

  const refreshConnection = async (id: string) => {
    const res = await fetch(`/api/mcp/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: true }),
      credentials: 'include',
    })
    if (res.ok) {
      await loadConnections()
    }
  }

  const deleteConnection = async (id: string) => {
    if (!confirm('Remove this MCP server?')) return
    await fetch(`/api/mcp/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    setConnections(connections.filter((c) => c.id !== id))
  }

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">MCP Servers</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Connect custom tool servers via the Model Context Protocol.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
          >
            + Add Server
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-6 space-y-3">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My MCP Server"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Server URL</label>
              <input
                type="url"
                value={form.serverUrl}
                onChange={(e) => setForm({ ...form, serverUrl: e.target.value })}
                placeholder="https://my-mcp-server.example.com/mcp"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Authentication</label>
              <select
                value={form.authType}
                onChange={(e) => setForm({ ...form, authType: e.target.value as typeof form.authType })}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="none">None</option>
                <option value="api_key">API Key</option>
              </select>
            </div>
            {form.authType === 'api_key' && (
              <div>
                <label className="block text-sm text-zinc-400 mb-1">API Key</label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={addConnection}
                disabled={adding || !form.name || !form.serverUrl}
                className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {adding ? 'Connecting...' : 'Connect & Discover Tools'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Connections list */}
        {loading ? (
          <p className="text-zinc-400">Loading...</p>
        ) : connections.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="text-zinc-400">No MCP servers connected.</p>
            <p className="mt-2 text-sm text-zinc-500">
              Add a server to extend Dock with custom tools.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-zinc-100">{conn.name}</h3>
                    <p className="text-sm text-zinc-400 font-mono">{conn.serverUrl}</p>
                    <p className="text-sm text-zinc-500 mt-1">
                      {conn.toolCount} tool{conn.toolCount !== 1 ? 's' : ''} discovered
                      {conn.authType !== 'none' && ` · ${conn.authType} auth`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleConnection(conn.id, !conn.enabled)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        conn.enabled
                          ? 'bg-emerald-900/50 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {conn.enabled ? 'On' : 'Off'}
                    </button>
                    <button
                      onClick={() => refreshConnection(conn.id)}
                      className="text-xs text-zinc-400 hover:text-cyan-400"
                    >
                      Refresh
                    </button>
                    <button
                      onClick={() => deleteConnection(conn.id)}
                      className="text-xs text-zinc-400 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {conn.tools && conn.tools.length > 0 && (
                  <div className="mt-3 border-t border-zinc-800 pt-3">
                    <p className="text-xs text-zinc-500 mb-1">Available tools:</p>
                    <div className="flex flex-wrap gap-1">
                      {conn.tools.map((tool) => (
                        <span
                          key={tool.name}
                          title={tool.description}
                          className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                        >
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
