'use client'

import { useState } from 'react'

interface WalletConnectProps {
  connected: boolean
  walletAddress?: string | null
  onConnected: () => void
  onDisconnect: () => void
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function OpenWalletConnect({ connected, walletAddress, onConnected, onDisconnect }: WalletConnectProps) {
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
      // Failed
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💰</span>
          <div>
            <h3 className="font-medium text-zinc-100">MoonPay Wallet</h3>
            <p className="text-sm text-zinc-400">Agent wallet &amp; payments</p>
          </div>
        </div>
        <div>
          {connected ? (
            <div className="flex items-center gap-2">
              <div className="text-right">
                <span className="text-sm text-emerald-400">Connected</span>
                {walletAddress && (
                  <p className="text-xs text-zinc-500 font-mono">{truncateAddress(walletAddress)}</p>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                className="text-sm text-zinc-500 hover:text-red-400 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(!showForm)}
              className="inline-flex items-center rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {showForm && !connected && (
        <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500">
            Set up your agent wallet with the MoonPay CLI:
          </p>
          <div className="rounded-md bg-zinc-800/50 p-2 font-mono text-xs text-zinc-300 space-y-1">
            <p>npm install -g @moonpay/cli</p>
            <p>mp login</p>
            <p>mp wallet create</p>
          </div>
          <p className="text-xs text-zinc-500">
            Then enter your OWS endpoint and API key below.
            Your API key is encrypted before storage.
          </p>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Endpoint URL</label>
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:8787"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="ows_..."
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          <button
            onClick={handleConnect}
            disabled={saving || !endpoint || !apiKey}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors disabled:opacity-50"
          >
            {saving ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      )}
    </div>
  )
}
