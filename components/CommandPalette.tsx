"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  LayoutDashboard,
  CheckSquare,
  Bell,
  Users,
  Folder,
  Calendar,
  Zap,
  Brain,
  FileText,
  Settings,
  TrendingUp,
  MessageSquare,
  Activity,
  SlidersHorizontal,
  Search,
  Plus,
  Rocket,
  Building2,
  Command,
  PanelRightOpen,
  Sparkles,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ── Command definitions ──────────────────────────────────────────────────────

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: LucideIcon
  category: "navigation" | "action" | "agent"
  keywords: string[]
  action: () => void
}

function useCommands(): CommandItem[] {
  const router = useRouter()
  const go = useCallback((path: string) => () => router.push(path), [router])

  const fire = useCallback((url: string, method = "POST") => () => {
    fetch(url, { method }).catch(() => null)
  }, [])

  return [
    // Navigation
    { id: "nav-vic", label: "Ask Vic", description: "Chief of staff, default in Assistant", icon: Sparkles, category: "navigation", keywords: ["vic", "chief", "staff", "ask", "chat", "⌘k"], action: go("/assistant") },
    { id: "nav-dashboard", label: "Dashboard", description: "Command center overview", icon: LayoutDashboard, category: "navigation", keywords: ["home", "overview", "briefing"], action: go("/dashboard") },
    { id: "nav-conversations", label: "Conversations", description: "Unified run and transcript inbox", icon: PanelRightOpen, category: "navigation", keywords: ["inbox", "transcript", "runs", "timeline"], action: go("/conversations") },
    { id: "nav-alerts", label: "Alerts", description: "Canonical failed-run inbox", icon: Bell, category: "navigation", keywords: ["incidents", "failures", "attention"], action: go("/alerts") },
    { id: "nav-chat", label: "Chat", description: "Talk to your agents", icon: MessageSquare, category: "navigation", keywords: ["message", "talk", "agent"], action: go("/assistant") },
    { id: "nav-tasks", label: "Tasks", description: "Kanban board", icon: CheckSquare, category: "navigation", keywords: ["kanban", "board", "todo"], action: go("/tasks") },
    { id: "nav-agents", label: "Agents", description: "Agent team management", icon: Users, category: "navigation", keywords: ["team", "vic", "scout", "builder", "baron"], action: go("/agents") },
    { id: "nav-skills", label: "Agent Skills", description: "Installed skills list", icon: SlidersHorizontal, category: "navigation", keywords: ["openclaw", "abilities"], action: go("/agents/skills") },
    { id: "nav-projects", label: "Projects", description: "GitHub repos + CI status", icon: Folder, category: "navigation", keywords: ["github", "repos", "ci", "pr"], action: go("/projects") },
    { id: "nav-calendar", label: "Calendar", description: "Google Calendar events", icon: Calendar, category: "navigation", keywords: ["events", "schedule", "meetings"], action: go("/calendar") },
    { id: "nav-intel", label: "Intel", description: "Scout research reports", icon: Zap, category: "navigation", keywords: ["research", "scout", "market"], action: go("/intel") },
    { id: "nav-docs", label: "Docs", description: "Documentation", icon: FileText, category: "navigation", keywords: ["documentation", "help"], action: go("/docs") },
    { id: "nav-memory", label: "Memory", description: "Agent memory browser", icon: Brain, category: "navigation", keywords: ["notes", "context"], action: go("/memory") },
    { id: "nav-activity", label: "Activity", description: "Activity feed", icon: Activity, category: "navigation", keywords: ["log", "history", "feed"], action: go("/activity") },
    { id: "nav-costs", label: "Costs", description: "Token usage + spend", icon: TrendingUp, category: "navigation", keywords: ["budget", "tokens", "spend", "money"], action: go("/costs") },
    { id: "nav-company", label: "Company", description: "Org chart, budgets, goals", icon: Building2, category: "navigation", keywords: ["org", "budget", "goals"], action: go("/company") },
    { id: "nav-settings", label: "Settings", description: "Configuration", icon: Settings, category: "navigation", keywords: ["config", "setup", "preferences"], action: go("/settings") },

    // Actions
    { id: "act-new-task", label: "New Task", description: "Create a task on the Kanban board", icon: Plus, category: "action", keywords: ["create", "add", "task"], action: go("/tasks") },
    { id: "act-deploy-scout", label: "Deploy Scout", description: "Run a market research sweep", icon: Rocket, category: "action", keywords: ["research", "intel", "scout", "deploy"], action: fire("/api/intel/deploy") },
  ]
}

// ── Fuzzy match ──────────────────────────────────────────────────────────────

function matchesQuery(command: CommandItem, query: string): boolean {
  const q = query.toLowerCase()
  if (command.label.toLowerCase().includes(q)) return true
  if (command.description?.toLowerCase().includes(q)) return true
  return command.keywords.some((k) => k.includes(q))
}

// ── Component ────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const commands = useCommands()

  const filtered = query.trim()
    ? commands.filter((c) => matchesQuery(c, query))
    : commands

  // Group by category
  const grouped: { category: string; items: CommandItem[] }[] = []
  const seen = new Set<string>()
  for (const item of filtered) {
    if (!seen.has(item.category)) {
      seen.add(item.category)
      grouped.push({ category: item.category, items: [] })
    }
    grouped.find((g) => g.category === item.category)!.items.push(item)
  }

  const flatFiltered = grouped.flatMap((g) => g.items)

  // ── Keyboard shortcut ──────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        setOpen((prev) => !prev)
        setQuery("")
        setSelectedIndex(0)
      }
      // ⌘K: jump to the Assistant with Vic selected (replaces the old floating Vic panel).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(false)
        router.push("/assistant")
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [router])

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll("[data-cmd-item]")
    items[selectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // ── Item keyboard nav ──────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, flatFiltered.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter" && flatFiltered[selectedIndex]) {
        e.preventDefault()
        flatFiltered[selectedIndex].action()
        setOpen(false)
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    },
    [flatFiltered, selectedIndex]
  )

  if (!open) return null

  const categoryLabels: Record<string, string> = {
    navigation: "Pages",
    action: "Actions",
    agent: "Agents",
  }

  let itemIndex = -1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg mx-4 rounded-xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: "#111118",
          border: "1px solid #1a1a2e",
          boxShadow: "0 0 40px rgba(124,58,237,0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #1a1a2e" }}>
          <Search size={16} className="text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <kbd
            className="hidden md:flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: "#1a1a2e", color: "#71717a" }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {flatFiltered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-600">No results found.</div>
          )}

          {grouped.map((group) => (
            <div key={group.category}>
              <p
                className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: "#52525b" }}
              >
                {categoryLabels[group.category] ?? group.category}
              </p>
              {group.items.map((cmd) => {
                itemIndex++
                const idx = itemIndex
                const isSelected = idx === selectedIndex
                const Icon = cmd.icon
                return (
                  <button
                    key={cmd.id}
                    data-cmd-item
                    className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                    style={{
                      backgroundColor: isSelected ? "rgba(124,58,237,0.12)" : "transparent",
                      color: isSelected ? "#e4e4e7" : "#a1a1aa",
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => {
                      cmd.action()
                      setOpen(false)
                    }}
                  >
                    <Icon size={16} className="shrink-0" style={{ opacity: 0.7 }} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium" style={{ color: isSelected ? "#ffffff" : "#e4e4e7" }}>
                        {cmd.label}
                      </span>
                      {cmd.description && (
                        <span className="ml-2" style={{ color: "#71717a", fontSize: "12px" }}>
                          {cmd.description}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 px-4 py-2 text-[11px]"
          style={{ borderTop: "1px solid #1a1a2e", color: "#52525b" }}
        >
          <span className="flex items-center gap-1">
            <kbd className="px-1 rounded" style={{ backgroundColor: "#1a1a2e" }}>↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 rounded" style={{ backgroundColor: "#1a1a2e" }}>↵</kbd> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 rounded" style={{ backgroundColor: "#1a1a2e" }}>esc</kbd> close
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Command size={10} />K Ask Vic
          </span>
        </div>
      </div>
    </div>
  )
}
