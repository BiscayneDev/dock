"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Folder } from "lucide-react"
import type { ProjectOption } from "./shared"

const pop = "absolute z-30 overflow-hidden rounded-[14px] shadow-2xl"
const popStyle = { background: "var(--surface-2)", border: "1px solid var(--line-strong)" }

/** Chooses the project a conversation belongs to. value null = "No project". */
export function ProjectPicker({
  projects,
  value,
  onChange,
  disabled,
  disabledHint,
}: {
  projects: ProjectOption[]
  value: string | null
  onChange: (projectId: string | null) => void
  disabled?: boolean
  disabledHint?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = value ? projects.find((p) => p.id === value) : null
  const label = value ? (current?.name ?? "Project") : "No project"

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledHint : "Choose the project for this chat"}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[220px] items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] hover:bg-white/5 disabled:opacity-50"
        style={{ color: value ? "var(--ink-2)" : "var(--ink-3)" }}
      >
        <Folder size={13} />
        <span className="truncate font-medium">{label}</span>
        <ChevronDown size={13} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div className={`${pop} left-0 top-full mt-2 w-64 p-1`} style={popStyle}>
          <ProjectList
            projects={projects}
            value={value}
            onPick={(id) => {
              onChange(id)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

/** The shared option list: "No project" first, then each project. */
export function ProjectList({
  projects,
  value,
  onPick,
}: {
  projects: ProjectOption[]
  value: string | null
  onPick: (projectId: string | null) => void
}) {
  const rows: Array<{ id: string | null; name: string }> = [{ id: null, name: "No project" }, ...projects]
  return (
    <div className="max-h-72 overflow-y-auto">
      {rows.map((row) => (
        <button
          key={row.id ?? "none"}
          type="button"
          onClick={() => onPick(row.id)}
          className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-white/5"
        >
          <span className="truncate text-[13px]" style={{ color: "var(--ink)" }}>
            {row.name}
          </span>
          {row.id === value && <Check size={13} style={{ color: "var(--ink-2)" }} />}
        </button>
      ))}
      {projects.length === 0 && (
        <p className="px-3 pb-2 pt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
          No projects yet. Launch a venture to create one.
        </p>
      )}
    </div>
  )
}
