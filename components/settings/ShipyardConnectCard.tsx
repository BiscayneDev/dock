"use client"

import { useCallback, useEffect, useState } from "react"

// Settings: connect this workspace to Shipyard Inference. Connect opens the Shipyard consent screen;
// the key is sealed on the server and never shown here. Disconnect revokes it at the gateway.

interface ConnectionStatus {
  connected: boolean
  keyId?: string
  scopes?: string[]
  budgetUsd?: number
  createdAt?: string
}

const REASONS: Record<string, string> = {
  denied: "You declined the connection.",
  bad_state: "That connection link was invalid or already used. Start again.",
  state_expired: "That connection link expired. Start again.",
  user_mismatch: "That connection was started by a different account.",
  exchange_failed: "Shipyard did not issue a key. Start again.",
  store_failed: "Dock could not save the connection. Try again.",
  not_configured: "Shipyard connection is not set up on this deployment.",
  sign_in: "Sign in again to finish connecting.",
}

export default function ShipyardConnectCard() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connect/shipyard", { cache: "no-store" })
      if (!res.ok) throw new Error("load")
      setStatus((await res.json()) as ConnectionStatus)
    } catch {
      setError("Could not load the Shipyard connection")
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("shipyard") === "connected") setNotice("Shipyard connected for this workspace.")
    const reason = params.get("reason")
    if (params.get("shipyard") === "error") setError(REASONS[reason ?? ""] ?? "Could not connect to Shipyard.")
    load()
  }, [load])

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/connect/shipyard/start", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start")
      window.location.assign(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the connection")
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/connect/shipyard", { method: "DELETE" })
      if (!res.ok) throw new Error("disconnect")
      setConfirming(false)
      setNotice("Shipyard disconnected. The key is revoked.")
      await load()
    } catch {
      setError("Could not disconnect Shipyard")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Shipyard</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Route this workspace&apos;s model calls through your Shipyard account, with a spend limit.</p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        {!status && !error && <p className="text-sm text-zinc-500">Loading…</p>}

        {status && !status.connected && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-zinc-400">Not connected.</p>
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Opening Shipyard…" : "Connect Shipyard"}
            </button>
          </div>
        )}

        {status?.connected && (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-zinc-500">Status</dt>
              <dd className="text-emerald-400">Connected</dd>
              <dt className="text-zinc-500">Scopes</dt>
              <dd className="text-zinc-200">{(status.scopes ?? []).join(", ") || "none"}</dd>
              <dt className="text-zinc-500">Budget</dt>
              <dd className="text-zinc-200">${(status.budgetUsd ?? 0).toFixed(2)} per connection</dd>
              <dt className="text-zinc-500">Key ID</dt>
              <dd className="font-mono text-xs text-zinc-300">{status.keyId}</dd>
            </dl>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Disconnect
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-400">Revoke this key?</span>
                <button type="button" onClick={disconnect} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50">
                  Revoke
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </section>
  )
}
