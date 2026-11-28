"use client"

import { useCallback, useEffect, useState } from "react"
import { inviteStatus, type InviteStatus } from "@/lib/invites"

// Owner-only Settings section. The one-time link is shown only in the create
// response; the list never receives a token or token hash.

interface InviteView {
  id: string
  email: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
}

interface CreatedInvite {
  email: string
  url: string
}

const STATUS_STYLE: Record<InviteStatus, { color: string; background: string }> = {
  pending: { color: "#22c55e", background: "rgba(34,197,94,0.12)" },
  used: { color: "#a1a1aa", background: "rgba(113,113,122,0.15)" },
  expired: { color: "#ef4444", background: "rgba(239,68,68,0.12)" },
}

function expiryLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown"
}

export default function InvitesSection() {
  const [invites, setInvites] = useState<InviteView[] | null>(null)
  const [email, setEmail] = useState("")
  const [created, setCreated] = useState<CreatedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invites", { cache: "no-store" })
      if (!res.ok) throw new Error("load")
      const data = (await res.json()) as { invites: InviteView[] }
      setInvites(data.invites)
      setError(null)
    } catch {
      setError("Could not load invites.")
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setCreated(null)
    setCopied(false)
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<CreatedInvite> & { error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not create the invite.")
      setCreated({ email: email.trim().toLowerCase(), url: data.url })
      setEmail("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite.")
    } finally {
      setCreating(false)
    }
  }

  async function copyLink() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Could not copy the link. Select it and copy it manually.")
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Invites</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Dock is invite-only. Create a one-use link for someone you want to join; it expires after 7 days.
        </p>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
        <form onSubmit={createInvite} className="flex flex-wrap items-center gap-2 p-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
            aria-label="Invitee email"
            placeholder="person@example.com"
            className="min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm text-zinc-200 outline-none"
            style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
          />
          <button
            type="submit"
            disabled={creating || !email.trim()}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed" }}
          >
            {creating ? "Creating…" : "Create invite"}
          </button>
        </form>

        {created && (
          <div className="space-y-2 border-t border-zinc-800/40 p-4">
            <p className="text-xs text-zinc-300">
              Invite for {created.email}. Copy the link now — it cannot be shown again.
            </p>
            <p className="break-all rounded bg-black/60 p-2 font-mono text-[11px] text-zinc-200">{created.url}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="rounded-md px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: "#1a1a2e", color: "#e4e4e7" }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => { setCreated(null); setCopied(false) }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-zinc-800/40">
          {invites === null ? (
            <div className="p-6 text-center text-xs text-zinc-600">Loading...</div>
          ) : invites.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-600">No invites yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-800/40">
              {invites.map((invite) => {
                const status = inviteStatus({ expires_at: invite.expiresAt, used_at: invite.usedAt })
                const tone = STATUS_STYLE[status]
                return (
                  <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200">{invite.email}</p>
                      <p className="text-[11px] text-zinc-500">Expires {expiryLabel(invite.expiresAt)}</p>
                    </div>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                      style={{ backgroundColor: tone.background, color: tone.color }}
                    >
                      {status}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <p className="px-4 pb-4 text-xs" style={{ color: "#ef4444" }} role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
