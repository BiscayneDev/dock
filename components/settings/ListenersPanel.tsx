"use client"

import { useCallback, useEffect, useState } from "react"

// Settings → Listeners: user-configurable event triggers. A listener turns a verified webhook
// delivery into an agent run, but only after cheap deterministic filters and dedupe. The webhook
// token is shown once at creation; the server keeps only a salted hash.

interface ListenerView {
  id: string
  name: string
  enabled: boolean
  filterRules: { match: "any" | "all"; rules: Array<{ path: string; op: string; value?: unknown }> }
  targetAgentKey: string
  runbook: string
  createdAt: string
  updatedAt: string
  lastTriggeredAt: string | null
  triggerCount: number
  pausedAt: string | null
  pauseReason: string | null
}

interface DeliveryView {
  id: string
  at: string
  eventId: string
  status: string
  detail: string | null
  runId: string | null
}

interface AgentOption {
  id?: string
  key?: string
  name: string
}

interface RuleDraft {
  path: string
  op: string
  value: string
}

const OPS = ["eq", "neq", "contains", "exists", "gt", "lt"] as const

function parseValue(raw: string): string | number | boolean {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw !== "" && Number.isFinite(Number(raw))) return Number(raw)
  return raw
}

function relative(iso: string | null): string {
  if (!iso) return "Never"
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return "just now"
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function ListenersPanel() {
  const [listeners, setListeners] = useState<ListenerView[] | null>(null)
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryView[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [agentKey, setAgentKey] = useState("")
  const [runbook, setRunbook] = useState("")
  const [match, setMatch] = useState<"any" | "all">("all")
  const [rules, setRules] = useState<RuleDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/listeners", { cache: "no-store" })
      if (!res.ok) throw new Error("load")
      const data = (await res.json()) as { listeners: ListenerView[] }
      setListeners(data.listeners)
      setError(null)
    } catch {
      setError("Could not load listeners")
    }
  }, [])

  useEffect(() => {
    load()
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => { if (Array.isArray(data)) setAgents(data as AgentOption[]) })
      .catch(() => null)
  }, [load])

  async function loadDeliveries(id: string) {
    try {
      const res = await fetch(`/api/listeners/${id}/deliveries?limit=50`, { cache: "no-store" })
      if (!res.ok) throw new Error("deliveries")
      const data = (await res.json()) as { deliveries: DeliveryView[] }
      setDeliveries((prev) => ({ ...prev, [id]: data.deliveries }))
    } catch {
      setDeliveries((prev) => ({ ...prev, [id]: [] }))
    }
  }

  async function create() {
    setBusy(true)
    setError(null)
    setCreatedUrl(null)
    try {
      const res = await fetch("/api/listeners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          targetAgentKey: agentKey,
          runbook,
          filterRules: {
            match,
            rules: rules
              .filter((r) => r.path.trim())
              .map((r) => r.op === "exists"
                ? { path: r.path.trim(), op: r.op }
                : { path: r.path.trim(), op: r.op, value: parseValue(r.value) }),
          },
        }),
      })
      const data = (await res.json()) as { listener?: ListenerView; webhookToken?: string; error?: string }
      if (!res.ok || !data.webhookToken) throw new Error(data.error ?? "Could not create listener")
      setCreatedUrl(`${window.location.origin}/api/webhooks/${data.webhookToken}`)
      setName("")
      setAgentKey("")
      setRunbook("")
      setRules([])
      setShowCreate(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create listener")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(listener: ListenerView) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/listeners/${listener.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !listener.enabled }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? "Could not update listener")
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update listener")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/listeners/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not delete listener")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete listener")
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl() {
    if (!createdUrl) return
    try {
      await navigator.clipboard.writeText(createdUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="listeners-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="listeners-heading" className="text-sm font-medium text-white">Listeners</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Wake an agent on a real event. Webhook → cheap filter → dedupe → run, with a correlation id on the run.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--gold)", color: "#0d0d12" }}
        >
          {showCreate ? "Cancel" : "New listener"}
        </button>
      </div>

      {error ? <p className="text-xs text-red-400" role="alert">{error}</p> : null}

      {createdUrl ? (
        <div className="space-y-2 rounded-xl p-3" style={{ backgroundColor: "#111118", border: "1px solid #2a2a1e" }}>
          <p className="text-xs text-zinc-400">Copy this webhook URL now — the token is shown once and cannot be recovered.</p>
          <div className="flex flex-wrap gap-2">
            <input
              readOnly
              value={createdUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md px-2 py-1.5 font-mono text-[11px]"
              style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
            />
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{ border: "1px solid var(--line-strong)", color: "var(--ink)" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <div className="space-y-3 rounded-xl p-4" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-zinc-400">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="PR merged"
                className="w-full rounded-md px-2 py-1.5 text-sm"
                style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              Agent key
              <input
                value={agentKey}
                onChange={(e) => setAgentKey(e.target.value)}
                placeholder="scout"
                list="listener-agent-keys"
                className="w-full rounded-md px-2 py-1.5 text-sm"
                style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
              />
              <datalist id="listener-agent-keys">
                {agents.map((a, i) => {
                  const key = a.key ?? a.id ?? ""
                  return key ? <option key={`${key}-${i}`} value={key}>{a.name}</option> : null
                })}
              </datalist>
            </label>
          </div>
          <label className="block space-y-1 text-xs text-zinc-400">
            Runbook (what the agent should do)
            <textarea
              value={runbook}
              onChange={(e) => setRunbook(e.target.value)}
              rows={2}
              placeholder="Summarize the change and flag anything risky"
              className="w-full rounded-md px-2 py-1.5 text-sm"
              style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
            />
          </label>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              Filters
              <select
                value={match}
                onChange={(e) => setMatch(e.target.value as "any" | "all")}
                className="rounded-md px-2 py-1"
                style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
              >
                <option value="all">match all</option>
                <option value="any">match any</option>
              </select>
              <span className="text-zinc-600">no rules = accept every event</span>
            </div>
            {rules.map((rule, index) => (
              <div key={index} className="grid grid-cols-[1fr,90px,1fr,auto] gap-2">
                <input
                  value={rule.path}
                  onChange={(e) => setRules((prev) => prev.map((r, i) => i === index ? { ...r, path: e.target.value } : r))}
                  placeholder="pull_request.state"
                  className="rounded-md px-2 py-1 font-mono text-[11px]"
                  style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
                />
                <select
                  value={rule.op}
                  onChange={(e) => setRules((prev) => prev.map((r, i) => i === index ? { ...r, op: e.target.value } : r))}
                  className="rounded-md px-1 py-1 text-[11px]"
                  style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
                >
                  {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                </select>
                <input
                  value={rule.value}
                  onChange={(e) => setRules((prev) => prev.map((r, i) => i === index ? { ...r, value: e.target.value } : r))}
                  placeholder={rule.op === "exists" ? "n/a" : "value"}
                  disabled={rule.op === "exists"}
                  className="rounded-md px-2 py-1 font-mono text-[11px] disabled:opacity-40"
                  style={{ backgroundColor: "#0a0a0f", color: "var(--ink)", border: "1px solid var(--line)" }}
                />
                <button
                  type="button"
                  onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                  aria-label="Remove rule"
                  className="rounded-md px-2 text-xs"
                  style={{ color: "var(--ink-3)" }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRules((prev) => [...prev, { path: "", op: "eq", value: "" }])}
              className="text-xs underline"
              style={{ color: "var(--ink-2)" }}
            >
              Add rule
            </button>
          </div>
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim() || !agentKey.trim()}
            className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ backgroundColor: "var(--gold)", color: "#0d0d12" }}
          >
            {busy ? "Creating…" : "Create listener"}
          </button>
        </div>
      ) : null}

      {listeners === null ? (
        <p className="text-xs text-zinc-500">Loading listeners…</p>
      ) : listeners.length === 0 ? (
        <p className="rounded-xl px-4 py-6 text-center text-xs text-zinc-500" style={{ border: "1px dashed var(--line-strong)" }}>
          No listeners yet. Create one to wake an agent when a webhook arrives.
        </p>
      ) : (
        <ul className="space-y-2">
          {listeners.map((listener) => (
            <li key={listener.id} className="rounded-xl p-3" style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{listener.name}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {listener.targetAgentKey} · {listener.triggerCount} runs · last {relative(listener.lastTriggeredAt)}
                    {listener.pausedAt ? ` · paused: ${listener.pauseReason ?? "circuit breaker"}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px]" style={{
                    color: listener.enabled && !listener.pausedAt ? "#6ee7b7" : "#fbbf24",
                    backgroundColor: listener.enabled && !listener.pausedAt ? "rgba(110,231,183,.12)" : "rgba(251,191,36,.12)",
                  }}>
                    {listener.enabled && !listener.pausedAt ? "Active" : "Paused"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(listener)}
                    disabled={busy}
                    className="rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
                    style={{ border: "1px solid var(--line-strong)", color: "var(--ink)" }}
                  >
                    {listener.enabled ? "Pause" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded((cur) => cur === listener.id ? null : listener.id)
                      if (expanded !== listener.id) loadDeliveries(listener.id)
                    }}
                    className="rounded-md px-2 py-1 text-[11px]"
                    style={{ border: "1px solid var(--line-strong)", color: "var(--ink-2)" }}
                  >
                    Deliveries
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(listener.id)}
                    disabled={busy}
                    className="rounded-md px-2 py-1 text-[11px] disabled:opacity-40"
                    style={{ color: "#f87171" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {listener.runbook ? <p className="mt-2 text-xs text-zinc-400">{listener.runbook}</p> : null}
              {listener.filterRules.rules.length > 0 ? (
                <p className="mt-1 font-mono text-[10px] text-zinc-600">
                  {listener.filterRules.match}: {listener.filterRules.rules.map((r) => `${r.path} ${r.op} ${String(r.value ?? "")}`).join(" · ")}
                </p>
              ) : null}
              {expanded === listener.id ? (
                <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
                  <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Recent deliveries</p>
                  {(deliveries[listener.id] ?? []).length === 0 ? (
                    <p className="text-[11px] text-zinc-600">No deliveries yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {(deliveries[listener.id] ?? []).map((d) => (
                        <li key={d.id} className="flex flex-wrap gap-x-3 font-mono text-[10px] text-zinc-400">
                          <span className="text-zinc-600">{relative(d.at)}</span>
                          <span style={{ color: d.status === "enqueued" ? "#6ee7b7" : undefined }}>{d.status}</span>
                          <span>{d.eventId}</span>
                          {d.runId ? <span className="text-zinc-600">run {d.runId.slice(0, 8)}</span> : null}
                          {d.detail ? <span className="text-zinc-600">{d.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
