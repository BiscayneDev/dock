"use client"

import { useCallback, useEffect, useState } from "react"

// Settings: pair the Dock mobile app. The owner mints a short-lived, single-use
// 6-digit code here, types it into the app, and the app exchanges it for a
// device-scoped credential. No persistent token is ever typed or shown. Device
// credentials are stored hashed and can be revoked per device below.

interface MobileDeviceView {
  id: string
  platform: string
  deviceLabel?: string
  createdAt: string
  revokedAt: string | null
}

interface PairCodeView {
  code: string
  expiresAt: string
  ttlMs: number
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

export default function MobilePairingSection() {
  const [devices, setDevices] = useState<MobileDeviceView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pairCode, setPairCode] = useState<PairCodeView | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mobile/device", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { devices: MobileDeviceView[] }
      setDevices(data.devices.filter((d) => !d.revokedAt))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load devices")
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!pairCode) return
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(pairCode.expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left <= 0) setPairCode(null)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [pairCode])

  async function createCode() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/mobile/pair/create", { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setPairCode((await res.json()) as PairCodeView)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create pairing code")
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    setRevokingId(id)
    setError(null)
    try {
      const res = await fetch("/api/mobile/device", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke device")
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Mobile app</h2>
        <p className="text-sm text-zinc-400">
          Pair the Dock app on your phone. Codes expire after 5 minutes and work once.
        </p>
      </div>

      {pairCode ? (
        <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-4 text-center">
          <div className="text-3xl font-mono tracking-widest text-white">{formatCode(pairCode.code)}</div>
          <div className="mt-1 text-sm text-zinc-400">
            Enter this in the app within {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </div>
        </div>
      ) : (
        <button
          onClick={createCode}
          disabled={creating}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "Creating..." : "Pair a phone"}
        </button>
      )}

      {devices && devices.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-white">{d.deviceLabel || d.platform || "Paired phone"}</div>
                <div className="text-xs text-zinc-500">Paired {new Date(d.createdAt).toLocaleDateString()}</div>
              </div>
              <button
                onClick={() => revoke(d.id)}
                disabled={revokingId === d.id}
                className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-400 disabled:opacity-50"
              >
                {revokingId === d.id ? "Revoking..." : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  )
}
