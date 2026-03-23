'use client'

import { useState } from 'react'

interface WalletConnectProps {
  connected: boolean
  walletAddress?: string | null
  chainLabel?: string | null
  balance?: string | null
  onConnected: () => void
  onDisconnect: () => void
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function OpenWalletConnect({
  connected,
  walletAddress,
  chainLabel,
  balance,
  onConnected,
  onDisconnect,
}: WalletConnectProps) {
  const [showForm, setShowForm] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleConnect = async () => {
    setError(null)
    setSaving(true)

    try {
      const res = await fetch('/api/integrations/openwallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, apiKey }),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Connection failed')
        return
      }

      setShowForm(false)
      setEndpoint('')
      setApiKey('')
      onConnected()
    } catch {
      setError('Failed to connect. Check your endpoint and API key.')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await fetch('/api/integrations/openwallet', {
        method: 'DELETE',
        credentials: 'include',
      })
      onDisconnect()
    } catch {
      // Failed silently
    }
  }

  if (connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Balance display */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 800,
              fontSize: '1.75rem',
              letterSpacing: '-0.02em',
            }}>
              {balance !== null ? `$${balance}` : '—'}
            </span>
            <span style={{
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 600,
              fontSize: '0.85rem',
              opacity: 0.5,
              marginLeft: '0.35rem',
            }}>
              USDC
            </span>
          </div>
          {chainLabel && (
            <span style={{
              fontSize: '0.7rem',
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 600,
              border: '1px solid var(--ink)',
              borderRadius: '1rem',
              padding: '0.15rem 0.5rem',
              opacity: 0.6,
            }}>
              {chainLabel}
            </span>
          )}
        </div>

        {/* Address + disconnect */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'var(--mesh-mint)',
            }} />
            <span style={{
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              opacity: 0.6,
            }}>
              {walletAddress ? truncateAddress(walletAddress) : 'Connected'}
            </span>
          </div>
          <button
            onClick={handleDisconnect}
            style={{
              background: 'none',
              border: 'none',
              fontFamily: "'Outfit', sans-serif",
              fontSize: '0.75rem',
              color: 'var(--mesh-peach)',
              cursor: 'pointer',
              padding: '0.25rem 0',
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <p style={{ fontSize: '0.85rem', opacity: 0.6, lineHeight: 1.5 }}>
        Your agent needs a wallet to use paid APIs (x402) and receive recipe payments. Set one up with MoonPay.
      </p>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="dock-btn-primary"
          style={{ alignSelf: 'flex-start' }}
        >
          Set up wallet
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Setup instructions */}
          <div style={{
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--ink)',
            opacity: 0.7,
            lineHeight: 1.8,
          }}>
            <div>npm install -g @moonpay/cli</div>
            <div>mp consent accept</div>
            <div>mp login --email your@email.com</div>
            <div>mp verify --email your@email.com --code 123456</div>
            <div>mp wallet create --name main</div>
          </div>

          <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>
            Then enter your OWS endpoint and API key. Your key is encrypted before storage.
          </p>

          <input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="Endpoint URL (e.g. http://localhost:8787)"
            className="dock-input"
          />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API Key"
            className="dock-input"
          />

          {error && (
            <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleConnect}
              disabled={saving || !endpoint || !apiKey}
              className="dock-btn-primary"
              style={{ opacity: saving || !endpoint || !apiKey ? 0.5 : 1 }}
            >
              {saving ? 'Connecting...' : 'Connect'}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null) }}
              className="dock-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export { truncateAddress }
