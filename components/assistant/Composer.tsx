"use client"

import { useState } from "react"
import { ChevronDown, Plus, ArrowUp } from "lucide-react"
import type { AgentDef } from "./shared"

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
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-[#404040] hover:bg-[#f0f0f0]"
      >
        <span>{value.emoji}</span>
        <span className="font-medium">{value.name}</span>
        <ChevronDown size={13} className="text-[#a3a3a3]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-[14px] border border-[#ebebeb] bg-white p-1 shadow-lg">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onChange(agent)
                setOpen(false)
              }}
              className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-[#f5f5f5]"
            >
              <span className="text-base">{agent.emoji}</span>
              <div>
                <p className="text-[13px] font-medium text-[#111]">{agent.name}</p>
                <p className="text-[11px] text-[#737373]">{agent.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  agents,
  agent,
  onAgentChange,
  busy,
  tray,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  agents: AgentDef[]
  agent: AgentDef
  onAgentChange: (agent: AgentDef) => void
  busy: boolean
  tray?: React.ReactNode
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="w-full rounded-[18px] bg-[#f4f4f4] p-2"
    >
      <div className="rounded-[14px] bg-white px-4 pb-3 pt-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#111] outline-none placeholder:text-[#a3a3a3]"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[#525252] hover:bg-[#f0f0f0]" aria-label="Add">
              <Plus size={16} />
            </button>
            <AgentPicker agents={agents} value={agent} onChange={onAgentChange} />
          </div>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            aria-label="Send"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111] text-white disabled:bg-[#d4d4d4]"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      {tray && <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[12px] text-[#737373]">{tray}</div>}
    </form>
  )
}
