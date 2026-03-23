'use client'

import { useState } from 'react'

interface PlaygroundProps {
  serviceName: string
  serviceUrl: string
  serviceDescription: string
  onClose: () => void
  onBuildRecipe: (description: string) => void
}

interface HeaderEntry { key: string; value: string }
interface ProxyResponse { status: number; statusText: string; headers: Record<string, string>; body: string; durationMs: number }

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

function statusColor(code: number): string {
  if (code < 300) return 'var(--mesh-mint)'
  if (code < 500) return 'var(--mesh-yellow)'
  return 'var(--mesh-peach)'
}

function formatJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

export function PlaygroundPanel({ serviceName, serviceUrl, serviceDescription, onClose, onBuildRecipe }: PlaygroundProps) {
  const [url, setUrl] = useState(serviceUrl)
  const [method, setMethod] = useState<typeof METHODS[number]>('GET')
  const [headers, setHeaders] = useState<HeaderEntry[]>([])
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<ProxyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [showHeaders, setShowHeaders] = useState(false)
  const [copied, setCopied] = useState(false)

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }])
  const removeHeader = (i: number) => setHeaders(headers.filter((_, idx) => idx !== i))
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setHeaders(headers.map((h, idx) => idx === i ? { ...h, [field]: val } : h))

  const send = async () => {
    setSending(true)
    setError(null)
    setResponse(null)
    try {
      const hdrs: Record<string, string> = {}
      headers.forEach((h) => { if (h.key.trim()) hdrs[h.key.trim()] = h.value })

      const res = await fetch('/api/playground/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, headers: Object.keys(hdrs).length > 0 ? hdrs : undefined, body: ['POST', 'PUT'].includes(method) ? body : undefined }),
        credentials: 'include',
      })

      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Request failed'); return }
      setResponse(json.data)
    } catch { setError('Network error') }
    finally { setSending(false) }
  }

  const copyResponse = () => {
    if (!response) return
    navigator.clipboard.writeText(formatJson(response.body))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="pg-panel">
      {/* Header */}
      <div className="pg-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>⚡</span>
            <h3 className="pg-title">{serviceName}</h3>
          </div>
          <p className="pg-desc">{serviceDescription}</p>
        </div>
        <button className="pg-close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Request builder */}
      <div className="pg-section">
        <div className="pg-url-row">
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof METHODS[number])} className="pg-method-select">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} className="pg-url-input" placeholder="https://..." />
        </div>

        {/* Headers */}
        <div className="pg-headers-section">
          <div className="pg-headers-row">
            <span className="ws-meta">Headers</span>
            <button className="pg-add-btn" onClick={addHeader}>+ Add</button>
          </div>
          {headers.length === 0 && <p className="pg-empty">No custom headers</p>}
          {headers.map((h, i) => (
            <div key={i} className="pg-header-entry">
              <input type="text" value={h.key} onChange={(e) => updateHeader(i, 'key', e.target.value)} placeholder="Key" className="pg-header-input" />
              <input type="text" value={h.value} onChange={(e) => updateHeader(i, 'value', e.target.value)} placeholder="Value" className="pg-header-input" />
              <button className="pg-remove-btn" onClick={() => removeHeader(i)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mesh-peach)" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>

        {/* Body */}
        {['POST', 'PUT'].includes(method) && (
          <div>
            <span className="ws-meta">Body</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder='{"key": "value"}' className="pg-body-input" />
          </div>
        )}

        {/* Send */}
        <button onClick={send} disabled={sending || !url.trim()} className="pg-send-btn">
          {sending ? 'Sending...' : 'Send Request'}
        </button>
      </div>

      {/* Error */}
      {error && <div className="pg-error">{error}</div>}

      {/* Response */}
      {response && (
        <div className="pg-section pg-response">
          <div className="pg-response-header">
            <span className="pg-status-badge" style={{ borderColor: statusColor(response.status), color: statusColor(response.status) }}>{response.status} {response.statusText}</span>
            <span className="pg-duration">{response.durationMs}ms</span>
            <button className="pg-copy-btn" onClick={copyResponse}>{copied ? 'Copied' : 'Copy'}</button>
          </div>

          {/* Response headers (collapsible) */}
          <button className="pg-resp-headers-toggle" onClick={() => setShowHeaders(!showHeaders)}>
            <span>{showHeaders ? '▾' : '▸'}</span>
            Response Headers ({Object.keys(response.headers).length})
          </button>
          {showHeaders && (
            <div className="pg-resp-headers">
              {Object.entries(response.headers).map(([k, v]) => (
                <div key={k}><strong>{k}:</strong> {v}</div>
              ))}
            </div>
          )}

          {/* Body */}
          <pre className="pg-resp-body">{formatJson(response.body)}</pre>
        </div>
      )}

      {/* Build recipe CTA */}
      <button className="pg-build-btn" onClick={() => onBuildRecipe(`Build a recipe that uses the ${serviceName} API at ${url}. ${serviceDescription}`)}>
        Build a recipe with this
      </button>

      <style>{`
        .pg-panel { border: var(--border-w) solid var(--ink); border-radius: var(--radius-lg); background: white; padding: 1.5rem; box-shadow: 4px 4px 0px var(--ink); margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
        .pg-header { display: flex; justify-content: space-between; align-items: flex-start; }
        .pg-title { font-family: 'Lora', serif; font-weight: 700; font-size: 1.15rem; }
        .pg-desc { font-size: 0.8rem; opacity: 0.6; margin-top: 0.25rem; }
        .pg-close { width: 32px; height: 32px; border-radius: 50%; border: var(--border-w) solid var(--ink); display: flex; align-items: center; justify-content: center; background: var(--cream); cursor: pointer; flex-shrink: 0; }
        .pg-close:hover { background: var(--mesh-peach); }
        .pg-section { display: flex; flex-direction: column; gap: 0.75rem; }
        .pg-url-row { display: flex; gap: 0.5rem; }
        .pg-method-select { width: 100px; padding: 0.5rem 0.75rem; border: var(--border-w) solid var(--ink); border-radius: var(--radius-md); font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.8rem; background: var(--cream); color: var(--ink); cursor: pointer; }
        .pg-url-input { flex: 1; padding: 0.5rem 0.75rem; border: var(--border-w) solid var(--ink); border-radius: var(--radius-md); font-family: monospace; font-size: 0.8rem; background: var(--cream); color: var(--ink); outline: none; }
        .pg-url-input:focus { box-shadow: 0 0 0 3px rgba(91,167,205,0.2); }
        .pg-headers-section { display: flex; flex-direction: column; gap: 0.4rem; }
        .pg-headers-row { display: flex; justify-content: space-between; align-items: center; }
        .pg-add-btn { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.7rem; background: none; border: var(--border-w) dashed var(--ink); border-radius: 1rem; padding: 0.2rem 0.6rem; cursor: pointer; opacity: 0.6; color: var(--ink); }
        .pg-add-btn:hover { opacity: 1; }
        .pg-empty { font-size: 0.75rem; opacity: 0.4; }
        .pg-header-entry { display: flex; gap: 0.35rem; align-items: center; }
        .pg-header-input { flex: 1; padding: 0.35rem 0.5rem; border: var(--border-w) solid var(--ink); border-radius: 0.5rem; font-family: monospace; font-size: 0.75rem; background: var(--cream); color: var(--ink); outline: none; }
        .pg-remove-btn { background: none; border: none; cursor: pointer; padding: 0.25rem; }
        .pg-body-input { width: 100%; padding: 0.5rem 0.75rem; border: var(--border-w) solid var(--ink); border-radius: var(--radius-md); font-family: monospace; font-size: 0.8rem; background: var(--cream); color: var(--ink); outline: none; resize: vertical; margin-top: 0.25rem; }
        .pg-send-btn { padding: 0.6rem 1.25rem; border: var(--border-w) solid var(--ink); border-radius: 2rem; background: var(--ink); color: var(--cream); font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.85rem; cursor: pointer; box-shadow: 2px 2px 0px var(--ink); }
        .pg-send-btn:hover { opacity: 0.85; }
        .pg-send-btn:disabled { opacity: 0.4; cursor: default; }
        .pg-error { padding: 0.6rem 0.75rem; border: var(--border-w) solid var(--mesh-peach); border-radius: var(--radius-md); color: var(--mesh-peach); font-size: 0.8rem; font-family: 'Outfit', sans-serif; font-weight: 600; }
        .pg-response { border-top: var(--border-w) solid var(--ink); padding-top: 1rem; }
        .pg-response-header { display: flex; align-items: center; gap: 0.75rem; }
        .pg-status-badge { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.8rem; border: var(--border-w) solid; border-radius: 1rem; padding: 0.2rem 0.6rem; }
        .pg-duration { font-family: 'Outfit', sans-serif; font-size: 0.75rem; opacity: 0.5; }
        .pg-copy-btn { margin-left: auto; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.7rem; border: var(--border-w) solid var(--ink); border-radius: 1rem; padding: 0.2rem 0.6rem; background: var(--cream); cursor: pointer; color: var(--ink); }
        .pg-resp-headers-toggle { display: flex; align-items: center; gap: 0.4rem; background: none; border: none; cursor: pointer; font-family: 'Outfit', sans-serif; font-size: 0.75rem; font-weight: 600; opacity: 0.6; color: var(--ink); padding: 0; text-align: left; }
        .pg-resp-headers-toggle:hover { opacity: 1; }
        .pg-resp-headers { font-family: monospace; font-size: 0.65rem; opacity: 0.6; display: flex; flex-direction: column; gap: 0.15rem; word-break: break-all; padding: 0.5rem; border: var(--border-w) solid var(--ink); border-radius: 0.5rem; background: var(--cream); }
        .pg-resp-body { font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; max-height: 300px; overflow: auto; padding: 0.75rem; border: var(--border-w) solid var(--ink); border-radius: var(--radius-md); background: var(--cream); line-height: 1.5; }
        .pg-build-btn { width: 100%; padding: 0.65rem; border: var(--border-w) solid var(--mesh-cyan); border-radius: 2rem; background: rgba(91,167,205,0.1); color: var(--ink); font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
        .pg-build-btn:hover { background: rgba(91,167,205,0.2); }
      `}</style>
    </div>
  )
}
