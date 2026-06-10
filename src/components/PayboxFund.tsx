'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

interface Wallet {
  credentialId: string
  name: string
  address: string | null
  chains: string[]
}

// Deposit / top-up panel for the user's Paybox wallet: address + QR + copy, and
// a MoonPay buy-with-card link when a publishable key is configured. Renders
// nothing until Paybox is connected (the connect prompt lives in PayboxSigningKey).
export function PayboxFund() {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/integrations/paybox/wallet', { credentials: 'include' })
        if (res.ok) {
          const d = await res.json()
          setConnected(Boolean(d.connected))
          const wallets: Wallet[] = d.wallets ?? []
          setWallet(wallets.find((w) => w.address) ?? wallets[0] ?? null)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading || !connected) return null

  if (!wallet?.address) {
    return (
      <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
        No Paybox wallet yet — create one in the Paybox app to deposit funds.
      </p>
    )
  }

  const chain = wallet.chains[0] ?? null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address as string)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem' }}>Add funds</p>
        <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>
          Deposit crypto to your Paybox wallet{chain ? ` (${chain})` : ''}.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center' }}>
        <div style={{ background: '#fff', padding: '0.4rem', borderRadius: 8, lineHeight: 0 }}>
          <QRCodeSVG value={wallet.address} size={92} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', minWidth: 0, flex: 1 }}>
          <code style={{ fontSize: '0.72rem', wordBreak: 'break-all', opacity: 0.8 }}>{wallet.address}</code>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={copy}
              className="dock-btn-secondary"
              style={{ padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}
            >
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
        </div>
      </div>
      <p style={{ fontSize: '0.72rem', opacity: 0.5 }}>
        Want to buy with a card? Ask the assistant to “top up my wallet” — it uses MoonPay Agents to
        generate a checkout link (no extra keys required).
      </p>
    </div>
  )
}
