'use client'

import { useCallback, useEffect, useState } from 'react'
import { HarborShell } from '@/components/HarborShell'

interface MCPConnection {
  id: string; name: string; serverUrl: string; authType: string
  enabled: boolean; toolCount: number
  tools: Array<{ name: string; description: string }>
}

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<MCPConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', serverUrl: '', authType: 'none' as 'none' | 'api_key', apiKey: '' })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp', { credentials: 'include' })
      if (res.ok) { const d = await res.json(); setConnections(d.connections ?? []) }
    } catch { /* Failed */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const addConnection = async () => {
    setAdding(true); setError(null)
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, serverUrl: form.serverUrl, authType: form.authType, authConfig: form.authType === 'api_key' ? { apiKey: form.apiKey } : undefined }),
        credentials: 'include',
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Failed'); return }
      setShowAdd(false); setForm({ name: '', serverUrl: '', authType: 'none', apiKey: '' }); await load()
    } catch { setError('Connection failed') } finally { setAdding(false) }
  }

  const toggle = async (id: string, enabled: boolean) => {
    await fetch(`/api/mcp/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }), credentials: 'include' })
    setConnections(connections.map((c) => c.id === id ? { ...c, enabled } : c))
  }

  const remove = async (id: string) => {
    if (!confirm('Remove this MCP server?')) return
    await fetch(`/api/mcp/${id}`, { method: 'DELETE', credentials: 'include' })
    setConnections(connections.filter((c) => c.id !== id))
  }

  return (
    <HarborShell title="MCP Servers" showBack>
      <p className="text-[15px] text-slate-500 mt-1 mb-4">Connect custom tool servers via Model Context Protocol.</p>

      <button onClick={() => setShowAdd(!showAdd)}
        className="w-full py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium hover:bg-slate-700 transition-colors mb-5">
        + Add Server
      </button>

      {showAdd && (
        <div className="glass-card rounded-[20px] p-5 mb-5 space-y-3">
          <input type="text" placeholder="Server name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700" />
          <input type="url" placeholder="https://my-server.example.com/mcp" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })}
            className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700" />
          <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as typeof form.authType })}
            className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700">
            <option value="none">No auth</option>
            <option value="api_key">API Key</option>
          </select>
          {form.authType === 'api_key' && (
            <input type="password" placeholder="API Key" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700" />
          )}
          {error && <p className="text-[13px] text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500">Cancel</button>
            <button onClick={addConnection} disabled={adding || !form.name || !form.serverUrl}
              className="flex-1 py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium disabled:opacity-50">
              {adding ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="glass-card rounded-[20px] h-20 animate-pulse" />)}</div>
      ) : connections.length === 0 ? (
        <div className="glass-card rounded-[24px] p-10 text-center">
          <i className="ph-fill ph-plugs-connected text-[40px] text-slate-400 mb-3" />
          <p className="text-[15px] text-slate-600">No MCP servers connected</p>
          <p className="text-[13px] text-slate-400 mt-1">Add a server to extend Dock with custom tools.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => (
            <div key={conn.id} className="glass-card rounded-[20px] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700 text-[15px]">{conn.name}</p>
                  <p className="text-[12px] text-slate-400 font-mono">{conn.serverUrl}</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">{conn.toolCount} tool{conn.toolCount !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggle(conn.id, !conn.enabled)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${conn.enabled ? 'bg-emerald-400' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${conn.enabled ? 'translate-x-5' : ''}`} />
                  </button>
                  <button onClick={() => remove(conn.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <i className="ph ph-trash text-[16px]" />
                  </button>
                </div>
              </div>
              {conn.tools.length > 0 && (
                <div className="mt-3 pt-2 border-t border-white/30 flex flex-wrap gap-1">
                  {conn.tools.map((t) => (
                    <span key={t.name} className="text-[10px] text-slate-400 bg-white/40 px-1.5 py-0.5 rounded-full">{t.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </HarborShell>
  )
}
