"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import PayboxPanel from "@/components/PayboxPanel"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Wallet {
  id: string
  label: string
  chain: "solana" | "ethereum" | "base" | "polygon" | "other"
  address: string
  balance?: number
  symbol?: string
  lastChecked?: string
  addedAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAIN_CONFIG: Record<string, { label: string; color: string; icon: string; explorer: string }> = {
  solana: { label: "Solana", color: "#9945ff", icon: "◎", explorer: "https://solscan.io/account/" },
  ethereum: { label: "Ethereum", color: "#627eea", icon: "Ξ", explorer: "https://etherscan.io/address/" },
  base: { label: "Base", color: "#0052ff", icon: "🔵", explorer: "https://basescan.org/address/" },
  polygon: { label: "Polygon", color: "#8247e5", icon: "⬡", explorer: "https://polygonscan.com/address/" },
  other: { label: "Other", color: "#71717a", icon: "🔗", explorer: "" },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(diff / 3600000)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [formLabel, setFormLabel] = useState("")
  const [formAddress, setFormAddress] = useState("")
  const [formChain, setFormChain] = useState<string>("solana")
  const [saving, setSaving] = useState(false)

  const fetchTreasury = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try {
      const res = await fetch(`/api/treasury${refresh ? "?refresh=true" : ""}`)
      const data = await res.json() as { wallets: Wallet[]; totals: Record<string, number> }
      setWallets(data.wallets ?? [])
      setTotals(data.totals ?? {})
    } catch { /* leave empty */ }
    finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchTreasury()
  }, [fetchTreasury])

  async function addWallet() {
    if (!formAddress.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: formLabel.trim() || undefined,
          address: formAddress.trim(),
          chain: formChain,
        }),
      })
      if (res.ok) {
        setAdding(false)
        setFormLabel("")
        setFormAddress("")
        fetchTreasury()
      }
    } finally { setSaving(false) }
  }

  async function removeWallet(id: string) {
    setWallets((prev) => prev.filter((w) => w.id !== id))
    await fetch(`/api/treasury?id=${id}`, { method: "DELETE" }).catch(() => fetchTreasury())
  }

  return (
    <div className="mx-auto max-w-[820px] space-y-6 px-5 pb-24 pt-2 lg:px-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
            <span
              className="h-[7px] w-[7px] rotate-45"
              style={{ background: "var(--gold)", boxShadow: "0 0 10px rgba(231,201,121,.6)" }}
            />
            Baron · On-chain
          </div>
          <h1
            className="mt-3 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.01em]"
            style={{ color: "var(--ink)" }}
          >
            Treasury
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--ink-2)" }}>
            On-chain wallets and balances
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchTreasury(true)}
            disabled={refreshing}
            className="rounded-[10px] border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-[1px] disabled:opacity-50"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="rounded-[10px] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-[1px]"
            style={{ backgroundColor: "var(--gold)", color: "#1a1508" }}
          >
            + Add Wallet
          </button>
        </div>
      </div>

      {/* Totals */}
      {Object.keys(totals).length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          {Object.entries(totals).map(([symbol, amount]) => (
            <div key={symbol} className="flex items-baseline gap-2">
              <span className="font-serif text-[28px] tabular-nums" style={{ color: "var(--ink)" }}>
                {amount < 0.001 ? amount.toFixed(6) : amount < 1 ? amount.toFixed(4) : amount.toFixed(2)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--gold)" }}>
                {symbol}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Paybox x402 wallet */}
      <PayboxPanel />

      {/* Add Wallet Form */}
      {adding && (
        <section
          className="rounded-[15px] border p-6"
          style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface-1), #08080b)" }}
        >
          <p className="mb-4 font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
            Add Wallet
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-3)" }}>
                Label (optional)
              </label>
              <input
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none transition-colors placeholder:opacity-50 focus:border-[var(--line-strong)]"
                style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder='e.g. "Baron treasury"'
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-3)" }}>
                Chain
              </label>
              <select
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
                value={formChain}
                onChange={(e) => setFormChain(e.target.value)}
              >
                {Object.entries(CHAIN_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <label className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-3)" }}>
              Wallet Address
            </label>
            <input
              className="w-full rounded-[10px] border px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:opacity-50 focus:border-[var(--line-strong)]"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
              placeholder="Paste wallet address..."
              autoFocus
            />
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={addWallet}
              disabled={saving || !formAddress.trim()}
              className="rounded-[10px] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-all duration-200 hover:-translate-y-[1px] disabled:opacity-50"
              style={{ backgroundColor: "var(--gold)", color: "#1a1508" }}
            >
              {saving ? "Adding..." : "Add Wallet"}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-[10px] border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors"
              style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Wallet List */}
      {loading ? (
        <div
          className="rounded-[15px] border p-8 text-center"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
        >
          <div className="mx-auto h-3.5 w-40 animate-pulse rounded" style={{ backgroundColor: "var(--surface-3)" }} />
        </div>
      ) : wallets.length === 0 ? (
        <div
          className="rounded-[15px] border p-12 text-center"
          style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--surface-1), #08080b)" }}
        >
          <p className="font-serif text-[34px]" style={{ color: "var(--ink-2)" }}>🏦</p>
          <p className="mt-3 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>No wallets configured</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-[1.6]" style={{ color: "var(--ink-3)" }}>
            Add wallet addresses to track balances across Solana, Ethereum, Base, and Polygon.
            Baron can monitor positions and execute DeFi strategies.
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-[15px] border"
          style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)" }}
        >
          {wallets.map((wallet) => {
            const chain = CHAIN_CONFIG[wallet.chain] ?? CHAIN_CONFIG.other
            return (
              <div
                key={wallet.id}
                className="group flex items-center justify-between border-b px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--line)" }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{ backgroundColor: chain.color }}
                    title={chain.label}
                  />
                  <div>
                    <p className="text-[13.5px] font-semibold tracking-[-0.003em]" style={{ color: "var(--ink)" }}>
                      {wallet.label}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {chain.explorer ? (
                        <a
                          href={`${chain.explorer}${wallet.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10.5px] transition-colors"
                          style={{ color: "var(--ink-3)" }}
                        >
                          {shortAddress(wallet.address)} ↗
                        </a>
                      ) : (
                        <span className="font-mono text-[10.5px]" style={{ color: "var(--ink-3)" }}>
                          {shortAddress(wallet.address)}
                        </span>
                      )}
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>
                        {chain.label} · checked {relativeTime(wallet.lastChecked)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {wallet.balance !== undefined && (
                    <div className="text-right">
                      <p className="font-serif text-[18px] tabular-nums" style={{ color: "var(--ink)" }}>
                        {wallet.balance < 0.001 ? wallet.balance.toFixed(6) :
                         wallet.balance < 1 ? wallet.balance.toFixed(4) :
                         wallet.balance.toFixed(2)}
                      </p>
                      <p className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>
                        {wallet.symbol}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => removeWallet(wallet.id)}
                    className="px-2 py-1 text-xs opacity-0 transition-all hover:opacity-100 group-hover:opacity-100"
                    style={{ color: "var(--ink-3)" }}
                    aria-label={`Remove ${wallet.label}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Back link */}
      <div className="pt-2">
        <Link href="/work" className="text-[12px] transition-colors" style={{ color: "var(--ink-3)" }}>
          ← Work
        </Link>
      </div>
    </div>
  )
}
