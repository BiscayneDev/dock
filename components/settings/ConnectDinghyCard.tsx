"use client"

import { useCallback, useEffect, useState } from "react"

// Settings: connect Dinghy (iMessage). Shows a one-time code to text to Dinghy, the connection status, and unlink.
// The connector token is never shown here; it lives only on Dinghy's side.

interface Status {
  connected: boolean
  linkedAt: string | null
  lastSeenAt: string | null
}

interface PairingView {
  code: string
  expiresAt: string
  ttlSeconds: number
  connectUrl: string
}

function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export default function ConnectDinghyCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [pairing, setPairing] = useState<PairingView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connector/setup", { cache: "no-store" })
      if (!res.ok) throw new Error("load")
      setStatus((await res.json()) as Status)
      setError(null)
    } catch {
      setError("Could not load the Dinghy connection")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // While a connect link is outstanding, poll so approval on the phone flips this card on its own.
  useEffect(() => {
    if (!pairing || status?.connected) return
    const timer = setInterval(() => {
      void load()
    }, 5000)
    return () => clearInterval(timer)
  }, [pairing, status?.connected, load])

  async function startPairing() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/connector/setup", { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as Partial<PairingView> & { error?: string }
      if (!res.ok || !data.code) throw new Error(data.error ?? "Could not start pairing")
      setPairing(data as PairingView)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start pairing")
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/connector/setup", { method: "DELETE" })
      if (!res.ok) throw new Error("unlink")
      setConfirming(false)
      setPairing(null)
      await load()
    } catch {
      setError("Could not unlink Dinghy")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Connect Dinghy</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Text your Chief of Staff from iMessage through Dinghy. Approvals for money actions come back to Dinghy for your
          yes or no.
        </p>
      </div>

      <div className="space-y-3 rounded-xl p-4" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        {status === null ? (
          <p className="text-xs text-zinc-600">Loading...</p>
        ) : status.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "#22c55e" }} aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-zinc-200">
              Connected
              <span className="text-[11px] text-zinc-500">
                {" "}
                · linked {status.linkedAt ? new Date(status.linkedAt).toLocaleDateString() : "recently"}
              </span>
            </p>
            {confirming ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={unlink}
                  disabled={busy}
                  className="rounded-md px-2.5 py-1 text-xs"
                  style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                >
                  {busy ? "Unlinking..." : "Confirm unlink"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md px-2.5 py-1 text-xs text-zinc-400"
                  style={{ backgroundColor: "#1a1a2e" }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                style={{ backgroundColor: "#1a1a2e" }}
              >
                Unlink
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "#62657a" }} aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-zinc-400">Not connected</p>
            <button
              type="button"
              onClick={startPairing}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "#7c3aed" }}
            >
              {busy ? "Starting..." : "Get a pairing code"}
            </button>
          </div>
        )}

        {pairing && !status?.connected && (
          <div className="space-y-3 rounded-md p-3" style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}>
            <p className="text-xs text-zinc-400">
              Open this link on the phone that uses Dinghy. It asks you to allow the connection - always, once, or
              not at all.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={pairing.connectUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: "#7c3aed" }}
              >
                Open the Dinghy connect link
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(pairing.connectUrl).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }}
                className="rounded-md px-2.5 py-1.5 text-xs text-zinc-300"
                style={{ backgroundColor: "#1a1a2e" }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Single use. Expires in {Math.round(pairing.ttlSeconds / 60)} minutes. This card updates by itself once
              you allow it.
            </p>
            <p className="text-[11px] text-zinc-500">
              Prefer the old way? Text <span className="font-mono text-zinc-300">pair {formatCode(pairing.code)}</span>{" "}
              to Dinghy in iMessage.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
