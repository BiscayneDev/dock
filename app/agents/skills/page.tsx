"use client"

import { useEffect, useState, useCallback } from "react"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

const AMBER = "#f59e0b"

const AGENTS = [
  { id: CHIEF_RUNTIME_KEY, name: "Chief of staff", emoji: "🧭" },
  { id: "scout",     name: "Scout",     emoji: "🔭" },
  { id: "builder",   name: "Builder",   emoji: "🏗️" },
  { id: "baron",     name: "Baron",     emoji: "🏦" },
  { id: "deal-flow", name: "Deal Flow", emoji: "🤝" },
]

const CATEGORY_COLORS: Record<string, string> = {
  research:      "#3b82f6",
  engineering:   "#22c55e",
  crypto:        "#f59e0b",
  communication: "#a855f7",
  productivity:  "#06b6d4",
  ai:            "#ec4899",
  other:         "#71717a",
}

interface Skill {
  name: string
  description: string
  category: string
}

export default function AgentSkillsPage() {
  const [activeAgent, setActiveAgent] = useState(CHIEF_RUNTIME_KEY)
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [catalog, setCatalog] = useState<Skill[]>([])
  const [original, setOriginal] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/skills", { cache: "no-store" })
      const data = await res.json()
      setAssignments(data.assignments ?? {})
      setOriginal(data.assignments ?? {})
      setCatalog(data.catalog ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const isDirty = JSON.stringify(assignments) !== JSON.stringify(original)
  const agentSkills = assignments[activeAgent] ?? []

  function toggle(skillName: string) {
    setAssignments(prev => {
      const current = prev[activeAgent] ?? []
      const next = current.includes(skillName)
        ? current.filter(s => s !== skillName)
        : [...current, skillName]
      return { ...prev, [activeAgent]: next }
    })
  }

  async function save() {
    setSaving(true)
    try {
      await fetch("/api/agents/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      })
      setOriginal(JSON.parse(JSON.stringify(assignments)))
      const agent = AGENTS.find(a => a.id === activeAgent)
      setToast("✓ Saved " + agent?.name + "'s skills")
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const byCategory = catalog.reduce<Record<string, Skill[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})
  const categories = Object.keys(byCategory).sort()

  return (
    <div className="max-w-5xl mx-auto pb-24 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Agent Skills</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Configure which skills each agent can use. Changes take effect on their next task.
        </p>
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {AGENTS.map(agent => (
          <button
            key={agent.id}
            onClick={() => setActiveAgent(agent.id)}
            className="px-4 py-2.5 text-sm font-medium transition-colors relative"
            style={{ color: activeAgent === agent.id ? AMBER : "#71717a" }}
          >
            {agent.emoji} {agent.name}
            {activeAgent === agent.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ backgroundColor: AMBER }} />
            )}
            {JSON.stringify(assignments[agent.id]) !== JSON.stringify(original[agent.id]) && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: AMBER }} />
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-600 text-sm py-8 text-center">Loading skills...</p>
      ) : (
        <div className="space-y-8">
          {categories.map(cat => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] + "20", color: CATEGORY_COLORS[cat] }}
                >
                  {cat}
                </span>
                <span className="text-xs text-zinc-600">
                  {byCategory[cat].filter(s => agentSkills.includes(s.name)).length} / {byCategory[cat].length} enabled
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {byCategory[cat].map(skill => {
                  const enabled = agentSkills.includes(skill.name)
                  return (
                    <button
                      key={skill.name}
                      onClick={() => toggle(skill.name)}
                      className="text-left rounded-xl p-3 transition-all"
                      style={{
                        backgroundColor: enabled ? "#111118" : "#0a0a0f",
                        border: enabled ? "1px solid " + AMBER + "40" : "1px solid #1a1a2e",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{skill.name}</p>
                          <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{skill.description}</p>
                        </div>
                        <div
                          className="shrink-0 w-9 h-5 rounded-full relative transition-colors mt-0.5"
                          style={{ backgroundColor: enabled ? AMBER : "#27272a" }}
                        >
                          <div
                            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                            style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
                          />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="fixed bottom-0 left-0 right-0 border-t px-6 py-3 flex items-center justify-between"
        style={{ backgroundColor: "#0a0a0f", borderColor: "#1a1a2e" }}
      >
        <p className="text-sm text-zinc-500">
          <span className="text-white font-medium">{agentSkills.length}</span> skills enabled for{" "}
          <span style={{ color: AMBER }}>{AGENTS.find(a => a.id === activeAgent)?.name}</span>
        </p>
        <div className="flex items-center gap-3">
          {toast && <span className="text-sm" style={{ color: AMBER }}>{toast}</span>}
          <button
            onClick={save}
            disabled={!isDirty || saving}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity"
            style={{
              backgroundColor: AMBER,
              color: "#000",
              opacity: isDirty && !saving ? 1 : 0.4,
              cursor: isDirty && !saving ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  )
}
