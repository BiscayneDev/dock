"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"

interface AgentMessage {
  id: string
  from: string
  to: string
  content: string
  type: "delegation" | "report" | "question" | "alert" | "handoff"
  taskId?: string
  taskTitle?: string
  timestamp: string
  read: boolean
}

interface AgentInfo {
  id: string
  name: string
  emoji: string
  accent: string
  isChief?: boolean
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  delegation: { label: "Delegation", color: "#7c3aed", icon: "📋" },
  report: { label: "Report", color: "#22c55e", icon: "📊" },
  question: { label: "Question", color: "#06b6d4", icon: "❓" },
  alert: { label: "Alert", color: "#ef4444", icon: "🚨" },
  handoff: { label: "Handoff", color: "#f59e0b", icon: "🤝" },
}

const FALLBACK_AGENTS: Record<string, { name: string; emoji: string; accent: string }> = {
  scout: { name: "Scout", emoji: "🔭", accent: "#06b6d4" },
  builder: { name: "Builder", emoji: "⚡", accent: "#10b981" },
  "deal-flow": { name: "Deal Flow", emoji: "🤝", accent: "#f59e0b" },
  baron: { name: "Baron", emoji: "🏦", accent: "#ec4899" },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")
  const [composing, setComposing] = useState(false)
  const [composeFrom, setComposeFrom] = useState("")
  const [composeTo, setComposeTo] = useState("")
  const [composeType, setComposeType] = useState<string>("delegation")
  const [composeContent, setComposeContent] = useState("")
  const [sending, setSending] = useState(false)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/messages?limit=100&canonical=1")
      const data = await res.json()
      if (Array.isArray(data)) setMessages(data)
    } catch {
      // leave empty
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents")
      const data = await res.json()
      if (Array.isArray(data)) setAgents(data)
    } catch {
      // use fallbacks
    }
  }, [])

  useEffect(() => {
    fetchMessages()
    fetchAgents()
    const interval = setInterval(fetchMessages, 15000)
    return () => clearInterval(interval)
  }, [fetchMessages, fetchAgents])

  function getAgent(id: string) {
    return agents.find((a) => a.id === id) ?? FALLBACK_AGENTS[id] ?? { name: id, emoji: "🤖", accent: "#71717a" }
  }

  async function sendMessage() {
    if (!composeFrom || !composeTo || !composeContent.trim()) return
    setSending(true)
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: composeFrom,
          to: composeTo,
          content: composeContent.trim(),
          type: composeType,
        }),
      })
      if (res.ok) {
        setComposing(false)
        setComposeContent("")
        fetchMessages()
      }
    } finally {
      setSending(false)
    }
  }

  const filtered = filter === "all"
    ? messages
    : messages.filter((m) => m.from === filter || m.to === filter)

  const agentIds = [...new Set(messages.flatMap((m) => [m.from, m.to]))]

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Messages</h1>
          <p className="text-sm text-zinc-500 mt-1">Canonical inter-agent message feed across task conversations</p>
        </div>
        <button
          onClick={() => {
            setComposing(true)
            if (agents.length > 0 && !composeFrom) {
              const chief = agents.find((a) => a.isChief || a.id === "chief")
              setComposeFrom(chief?.id ?? agents[0].id)
              setComposeTo(agents.find((a) => a.id !== (chief?.id ?? agents[0].id))?.id ?? "")
            }
          }}
          className="px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
          style={{
            backgroundColor: "rgba(124,58,237,0.15)",
            border: "1px solid rgba(124,58,237,0.3)",
            color: "#a78bfa",
          }}
        >
          + New Message
        </button>
      </div>

      {composing && (
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ backgroundColor: "#111118", border: "1px solid rgba(124,58,237,0.3)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#a78bfa" }}>
            Send Inter-Agent Message
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">From</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={composeFrom}
                onChange={(e) => setComposeFrom(e.target.value)}
              >
                <option value="">Select agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">To</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
              >
                <option value="">Select agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Type</label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
                value={composeType}
                onChange={(e) => setComposeType(e.target.value)}
              >
                {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none resize-none"
            style={{ backgroundColor: "#0a0a0f", border: "1px solid #1a1a2e" }}
            rows={3}
            value={composeContent}
            onChange={(e) => setComposeContent(e.target.value)}
            placeholder="Message content..."
            autoFocus
          />

          <div className="flex gap-2">
            <button
              onClick={sendMessage}
              disabled={sending || !composeFrom || !composeTo || !composeContent.trim()}
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "#7c3aed", color: "white" }}
            >
              {sending ? "Sending..." : "Send"}
            </button>
            <button
              onClick={() => setComposing(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition-colors"
              style={{ backgroundColor: "#1a1a2e" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {agentIds.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor: filter === "all" ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.05)",
              color: filter === "all" ? "#a78bfa" : "#71717a",
              border: `1px solid ${filter === "all" ? "rgba(124,58,237,0.3)" : "#1a1a2e"}`,
            }}
          >
            All
          </button>
          {agentIds.map((id) => {
            const a = getAgent(id)
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                style={{
                  backgroundColor: filter === id ? `${a.accent}20` : "rgba(255,255,255,0.05)",
                  color: filter === id ? a.accent : "#71717a",
                  border: `1px solid ${filter === id ? `${a.accent}40` : "#1a1a2e"}`,
                }}
              >
                {a.emoji} {a.name}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div
          className="rounded-2xl p-8 text-center text-xs text-zinc-600"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          Loading messages...
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center space-y-3"
          style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
        >
          <p className="text-3xl">💬</p>
          <p className="text-sm text-zinc-400">No inter-agent messages yet</p>
          <p className="text-xs text-zinc-600 max-w-sm mx-auto">
            Canonical task conversations now emit delegation, report, and handoff messages here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((msg) => {
            const fromAgent = getAgent(msg.from)
            const toAgent = getAgent(msg.to)
            const typeConfig = TYPE_CONFIG[msg.type] ?? TYPE_CONFIG.report

            return (
              <div
                key={msg.id}
                className="rounded-xl p-4 space-y-2 transition-all hover:bg-white/[0.02]"
                style={{ backgroundColor: "#111118", border: "1px solid #1a1a2e" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{fromAgent.emoji}</span>
                    <span className="text-sm font-semibold" style={{ color: fromAgent.accent }}>
                      {fromAgent.name}
                    </span>
                    <span className="text-xs text-zinc-600">→</span>
                    <span className="text-base">{toAgent.emoji}</span>
                    <span className="text-sm font-semibold" style={{ color: toAgent.accent }}>
                      {toAgent.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${typeConfig.color}18`, color: typeConfig.color }}
                    >
                      {typeConfig.icon} {typeConfig.label}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {relativeTime(msg.timestamp)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap pl-7">
                  {msg.content}
                </p>

                {msg.taskTitle && (
                  <div className="pl-7">
                    <Link
                      href={msg.taskId ? `/conversations?id=task-${msg.taskId}` : "/conversations"}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full transition-colors hover:bg-white/5"
                      style={{ backgroundColor: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}
                    >
                      📋 {msg.taskTitle}
                    </Link>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="pt-2">
        <Link href="/dashboard" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          ← Dashboard
        </Link>
      </div>
    </div>
  )
}
