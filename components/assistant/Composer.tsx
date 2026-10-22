"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Plus, ArrowUp, Paperclip, X, Sparkles, Plug } from "lucide-react"
import type { AgentDef, ProjectOption } from "./shared"
import { ModelPicker, type ModelRef, type ProviderModels } from "./ModelPicker"
import { ProjectPicker } from "./ProjectPicker"

export interface IntegrationStatus {
  id: string
  name: string
  description?: string
  connected: boolean
  error?: string
}

const pop = "absolute z-30 overflow-hidden rounded-[14px] shadow-2xl"
const popStyle = { background: "var(--surface-2)", border: "1px solid var(--line-strong)" }

export function AgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: AgentDef[]
  value: AgentDef
  onChange: (agent: AgentDef) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] hover:bg-white/5"
        style={{ color: "var(--ink-2)" }}
      >
        <span>{value.emoji}</span>
        <span className="font-medium">{value.name}</span>
        <ChevronDown size={13} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div className={`${pop} bottom-full left-0 mb-2 w-64 p-1`} style={popStyle}>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onChange(agent)
                setOpen(false)
              }}
              className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-white/5"
            >
              <span className="text-base">{agent.emoji}</span>
              <div>
                <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                  {agent.name}
                </p>
                <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                  {agent.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function IntegrationPicker({ integrations }: { integrations: IntegrationStatus[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const connected = integrations.filter((i) => i.connected).length

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const filtered = integrations.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
        style={{ color: "var(--ink-3)" }}
      >
        <Plug size={12} />
        {integrations.length ? `${connected} of ${integrations.length} connected` : "Connect apps"}
      </button>
      {open && (
        <div className={`${pop} bottom-full right-0 mb-2 w-72 p-2`} style={popStyle}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations"
            className="mb-2 w-full rounded-[10px] bg-black/20 px-3 py-2 text-[13px] outline-none"
            style={{ color: "var(--ink)", border: "1px solid var(--line)" }}
          />
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {filtered.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px]" style={{ color: "var(--ink)" }}>
                    {i.name}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {i.connected ? i.description ?? "Connected" : i.error ?? "Not connected"}
                  </p>
                </div>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: i.connected ? "#22c55e" : "var(--line-strong)" }}
                />
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px]" style={{ color: "var(--ink-3)" }}>
                No integrations match.
              </p>
            )}
          </div>
          <a href="/settings" className="mt-2 block rounded-[10px] px-3 py-2 text-center text-[12px] hover:bg-white/5" style={{ color: "var(--ink-2)" }}>
            Manage in Settings
          </a>
        </div>
      )}
    </div>
  )
}

const QUICK_ACTIONS = [
  { label: "Polish", prompt: "Polish this so it reads clearly and professionally:\n\n" },
  { label: "Shorter", prompt: "Make this shorter without losing the key points:\n\n" },
  { label: "Fix tone", prompt: "Fix the tone of this to be warmer and more direct:\n\n" },
  { label: "Draft reply", prompt: "Draft a reply to this:\n\n" },
]

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  agents,
  agent,
  onAgentChange,
  busy,
  integrations,
  attachments,
  onAttach,
  onRemoveAttachment,
  showQuickActions,
  models,
  model,
  onModelChange,
  projects = [],
  projectId = null,
  onProjectChange,
  projectEditable = true,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  agents: AgentDef[]
  agent: AgentDef
  onAgentChange: (agent: AgentDef) => void
  busy: boolean
  integrations: IntegrationStatus[]
  attachments: { name: string; size: number }[]
  onAttach: (files: FileList) => void
  onRemoveAttachment: (index: number) => void
  showQuickActions?: boolean
  models: ProviderModels[]
  model: ModelRef
  onModelChange: (ref: ModelRef) => void
  projects?: ProjectOption[]
  projectId?: string | null
  /** Attaches this conversation to a project (null = "No project"). Omit to hide the picker. */
  onProjectChange?: (projectId: string | null) => void
  /** False for older chats, which cannot be moved between projects. */
  projectEditable?: boolean
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  // "@" tagging: an open mention is the text from "@" to the caret. Choosing a project removes it.
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null)
  const canTag = Boolean(onProjectChange) && projectEditable
  const matches = mention
    ? projects.filter((p) => p.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8)
    : []

  function detectMention(text: string, caret: number) {
    if (!canTag) return setMention(null)
    const before = text.slice(0, caret)
    const found = /(^|\s)@([^\s@]*)$/.exec(before)
    setMention(found ? { query: found[2], start: caret - found[2].length - 1, end: caret } : null)
  }

  function pickProject(project: ProjectOption | null) {
    if (!mention) return
    onChange(value.slice(0, mention.start) + value.slice(mention.end))
    setMention(null)
    onProjectChange?.(project?.id ?? null)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="w-full rounded-[18px] p-2"
      style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
    >
      <div className="relative rounded-[14px] px-4 pb-3 pt-4" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
        {mention && canTag && (
          <div className={`${pop} bottom-full left-2 right-2 mb-2 p-1`} style={popStyle} data-testid="mention-list">
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
              Tag a project
            </p>
            {matches.length > 0 ? (
              matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickProject(p)
                  }}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] hover:bg-white/5"
                  style={{ color: "var(--ink)" }}
                >
                  @{p.name}
                </button>
              ))
            ) : (
              <p className="px-3 pb-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
                No project matches.
              </p>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="flex items-center gap-2 rounded-full px-3 py-1 text-[12px]"
                style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
              >
                <Paperclip size={11} /> {a.name}
                <button type="button" onClick={() => onRemoveAttachment(i)} aria-label={`Remove ${a.name}`}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={(e) => {
            if (mention && canTag) {
              if (e.key === "Escape") {
                e.preventDefault()
                setMention(null)
                return
              }
              if (e.key === "Enter" && !e.shiftKey && matches.length > 0) {
                e.preventDefault()
                pickProject(matches[0])
                return
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
          style={{ color: "var(--ink)" }}
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onAttach(e.target.files)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/5"
              style={{ color: "var(--ink-2)" }}
              aria-label="Attach text files"
            >
              <Plus size={16} />
            </button>
            <AgentPicker agents={agents} value={agent} onChange={onAgentChange} />
            <ModelPicker providers={models} value={model} onChange={onModelChange} />
            {onProjectChange && (
              <ProjectPicker
                projects={projects}
                value={projectId}
                onChange={onProjectChange}
                disabled={!projectEditable}
                disabledHint="Older chats stay under No project"
              />
            )}
          </div>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            aria-label="Send"
            className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-30"
            style={{ background: "var(--ink)", color: "var(--surface-0)" }}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
        <div className="flex items-center gap-1">
          {showQuickActions &&
            QUICK_ACTIONS.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => onChange(q.prompt + value)}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] hover:bg-white/5"
                style={{ color: "var(--ink-3)" }}
              >
                <Sparkles size={10} /> {q.label}
              </button>
            ))}
        </div>
        <IntegrationPicker integrations={integrations} />
      </div>
    </form>
  )
}
