'use client'

import { useCallback, useEffect, useState } from 'react'
import { HarborShell } from '@/components/HarborShell'

interface MCPConnection { id: string; name: string; serverUrl: string; authType: string; enabled: boolean; toolCount: number; tools: Array<{ name: string }> }

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<MCPConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', serverUrl: '', authType: 'none' as 'none' | 'api_key', apiKey: '' })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const res = await fetch('/api/mcp', { credentials: 'include' }); if (res.ok) setConnections((await res.json()).connections ?? []) } catch {} finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setAdding(true); setError(null)
    try { const res = await fetch('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, serverUrl: form.serverUrl, authType: form.authType, authConfig: form.authType === 'api_key' ? { apiKey: form.apiKey } : undefined }), credentials: 'include' }); const d = await res.json(); if (!res.ok) { setError(d.error); return }; setShowAdd(false); setForm({ name: '', serverUrl: '', authType: 'none', apiKey: '' }); await load() } catch { setError('Failed') } finally { setAdding(false) }
  }
  const toggle = async (id: string, enabled: boolean) => { await fetch(`/api/mcp/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }), credentials: 'include' }); setConnections(connections.map((c) => c.id === id ? { ...c, enabled } : c)) }
  const remove = async (id: string) => { if (!confirm('Remove?')) return; await fetch(`/api/mcp/${id}`, { method: 'DELETE', credentials: 'include' }); setConnections(connections.filter((c) => c.id !== id)) }

  return (
    <HarborShell title="MCP Servers" showBack>
      <p style={{ opacity: 0.5, fontSize: '0.9rem', marginBottom: '1rem' }}>Extend Dock with custom tool servers.</p>

      <button onClick={() => setShowAdd(!showAdd)} className="dock-btn-primary" style={{ width: '100%', marginBottom: '1rem' }}>+ Add Server</button>

      {showAdd && (
        <div className="dock-card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input type="text" placeholder="Server name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="dock-input" />
            <input type="url" placeholder="https://server.example.com/mcp" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} className="dock-input" />
            <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as typeof form.authType })} className="dock-input"><option value="none">No auth</option><option value="api_key">API Key</option></select>
            {form.authType === 'api_key' && <input type="password" placeholder="API Key" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="dock-input" />}
            {error && <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.75rem' }}><button onClick={() => setShowAdd(false)} className="dock-btn-secondary" style={{ flex: 1 }}>Cancel</button><button onClick={add} disabled={adding || !form.name || !form.serverUrl} className="dock-btn-primary" style={{ flex: 1 }}>{adding ? 'Connecting...' : 'Connect'}</button></div>
          </div>
        </div>
      )}

      {loading ? <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>{[1, 2].map((i) => <div key={i} className="dock-card" style={{ height: '5rem', opacity: 0.3 }} />)}</div>
      : connections.length === 0 ? (
        <div className="dock-card" style={{ padding: '3rem', alignItems: 'center', textAlign: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, marginBottom: '1rem' }}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><circle cx="17" cy="17" r="3" /></svg>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>No servers connected</p>
          <p style={{ fontSize: '0.85rem', opacity: 0.5, marginTop: '0.25rem' }}>Add an MCP server to extend Dock with custom tools.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {connections.map((c) => (
            <div key={c.id} className="dock-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem' }}>{c.name}</p>
                  <p style={{ fontSize: '0.75rem', opacity: 0.4, fontFamily: 'monospace' }}>{c.serverUrl}</p>
                  <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '0.15rem' }}>{c.toolCount} tool{c.toolCount !== 1 ? 's' : ''}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button className="dock-toggle" data-on={String(c.enabled)} onClick={() => toggle(c.id, !c.enabled)}><span className="dock-toggle-knob" style={{ left: c.enabled ? undefined : '2px', right: c.enabled ? '2px' : undefined }} /></button>
                  <button onClick={() => remove(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></button>
                </div>
              </div>
              {c.tools.length > 0 && (
                <div style={{ marginTop: '0.5rem', borderTop: '1.5px solid var(--ink)', paddingTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {c.tools.map((t) => <span key={t.name} className="meta-text" style={{ border: '1px solid var(--ink)', borderRadius: '1rem', padding: '0.1rem 0.4rem', opacity: 0.5 }}>{t.name}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </HarborShell>
  )
}
