"use client"

import { useCallback, useEffect, useState } from "react"
import { WaveBackground } from "@/components/onboarding/WaveBackground"

// Settings: paired devices (home node). Shows online/offline from the last heartbeat, starts pairing with a
// one-time code, and revokes. Token hashes never reach the browser; the plaintext token is only on the device.

interface DeviceView {
  id: string
  name: string
  paired: boolean
  online: boolean
  lastSeenAt: string | null
  createdAt: string
}

interface PairingView {
  id: string
  name: string
  code: string
  expiresAt: string
  ttlSeconds: number
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return "Never"
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return "just now"
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export default function DevicesSection() {
  const [devices, setDevices] = useState<DeviceView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<PairingView | null>(null)
  const [pairName, setPairName] = useState("My laptop")
  const [starting, setStarting] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [origin, setOrigin] = useState("https://shipyard-teal.vercel.app")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" })
      if (!res.ok) throw new Error("load")
      const data = (await res.json()) as { devices: DeviceView[] }
      setDevices(data.devices)
      setError(null)
    } catch {
      setError("Could not load devices")
    }
  }, [])

  useEffect(() => {
    setOrigin(window.location.origin)
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [load])

  async function startPairing() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pairName.trim() || "My laptop" }),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<PairingView> & { error?: string }
      if (!res.ok || !data.code || !data.id) throw new Error(data.error ?? "Could not start pairing")
      setPairing(data as PairingView)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start pairing")
    } finally {
      setStarting(false)
    }
  }

  async function revoke(id: string) {
    setRevokingId(id)
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok) throw new Error("revoke")
      setConfirmId(null)
      await load()
    } catch {
      setError("Could not revoke the device")
    } finally {
      setRevokingId(null)
    }
  }

  const command = pairing ? `node node/dock-node/bin/dock-node.mjs pair ${formatCode(pairing.code)} --server ${origin}` : ""

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Devices</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Your laptop or Mac mini runs home tasks. Home tasks wait while no device is online; they never fall back to the cloud.
        </p>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        {devices === null ? (
          <div className="p-6 text-center text-xs text-zinc-600">Loading...</div>
        ) : devices.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-600">No devices paired yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {devices.map((d) => {
              const status = !d.paired ? "Pairing pending" : d.online ? "Online" : "Offline"
              const dot = !d.paired ? "#62657a" : d.online ? "#22c55e" : "#ef4444"
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-200">{d.name}</p>
                    <p className="text-[11px] text-zinc-500">
                      {status} · last seen {lastSeenLabel(d.lastSeenAt)}
                    </p>
                  </div>
                  {confirmId === d.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => revoke(d.id)}
                        disabled={revokingId === d.id}
                        className="rounded-md px-2.5 py-1 text-xs"
                        style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                      >
                        {revokingId === d.id ? "Revoking..." : "Confirm revoke"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="rounded-md px-2.5 py-1 text-xs text-zinc-400"
                        style={{ backgroundColor: "#1a1a2e" }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(d.id)}
                      className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                      style={{ backgroundColor: "#1a1a2e" }}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="space-y-3 border-t border-zinc-800/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={pairName}
              onChange={(e) => setPairName(e.target.value)}
              maxLength={80}
              aria-label="Device name"
              className="min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm text-zinc-200 outline-none"
              style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
            />
            <button
              type="button"
              onClick={startPairing}
              disabled={starting}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "#7c3aed" }}
            >
              {starting ? "Starting..." : "Pair a device"}
            </button>
          </div>

          {pairing && (
            // Pairing launch panel: the wave loop sits behind a dark scrim; the code card is solid so the code stays readable.
            <div className="relative isolate overflow-hidden rounded-md" style={{ border: "1px solid #1a1a2e" }}>
              <WaveBackground contained />
              <div
                className="relative z-10 m-3 min-w-0 space-y-2 rounded-md p-3 sm:m-4 sm:p-4"
                style={{ backgroundColor: "var(--surface-1)", border: "1px solid #1a1a2e" }}
              >
                <p className="text-xs text-zinc-300">
                  Pairing code (single use, expires in {Math.round(pairing.ttlSeconds / 60)} minutes):
                </p>
                <p className="break-all font-mono text-lg tracking-widest text-white">{formatCode(pairing.code)}</p>
                <p className="text-xs text-zinc-300">Run this on the machine that should run home tasks, from your Dock checkout:</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/60 p-2 text-[11px] text-zinc-200">{command}</pre>
                <p className="text-[11px] text-zinc-400">
                  Then start it with <span className="font-mono">node node/dock-node/bin/dock-node.mjs run</span>. The code cannot be shown again.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs" style={{ color: "#ef4444" }} role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
