"use client"

import type { ReactNode } from "react"
import type { BadgeStyle } from "./format"

export function Badge({ style, title }: { style: BadgeStyle; title?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
      style={{
        color: style.color,
        background: `${style.color}14`,
        border: `1px solid ${style.color}38`,
      }}
      title={title}
      role="status"
    >
      {style.label}
    </span>
  )
}

export function SectionHeader({
  label,
  count,
  right,
}: {
  label: string
  count?: number | null
  right?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: "var(--ink-3)" }}>
        {label}
        {typeof count === "number" ? <span style={{ color: "var(--ink-2)" }}> · {count}</span> : null}
      </h2>
      {right}
    </div>
  )
}

export function EmptyState({ icon = "◎", title, body }: { icon?: string; title: string; body?: string }) {
  return (
    <div
      className="rounded-[15px] border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "var(--line-strong)", backgroundColor: "var(--surface-1)" }}
    >
      <p className="text-[22px]" style={{ color: "var(--ink-3)" }}>
        {icon}
      </p>
      <p className="mt-2 text-[13.5px] font-medium" style={{ color: "var(--ink-2)" }}>
        {title}
      </p>
      {body ? (
        <p className="mx-auto mt-1 max-w-[52ch] text-[12px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
          {body}
        </p>
      ) : null}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      className="rounded-xl px-4 py-3 text-[13px]"
      style={{
        color: "#f87171",
        background: "rgba(248,113,113,0.08)",
        border: "1px solid rgba(248,113,113,0.25)",
      }}
      role="alert"
    >
      {message}
    </p>
  )
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-[15px] border px-6 py-10 text-[13px]"
      style={{ borderColor: "var(--line)", backgroundColor: "var(--surface-1)", color: "var(--ink-3)" }}
      role="status"
      aria-live="polite"
    >
      <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border border-current" />
      {label}
    </div>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  type?: "button" | "submit"
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="min-h-[36px] rounded-[8px] px-3 text-[12px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: "var(--surface-2)",
        color: "var(--ink)",
        border: "1px solid var(--line-strong, var(--line))",
      }}
    >
      {children}
    </button>
  )
}

export function GoldButton({
  children,
  onClick,
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  type?: "button" | "submit"
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="min-h-[36px] rounded-[8px] px-4 text-[12px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: "var(--gold)", color: "#1a1508" }}
    >
      {children}
    </button>
  )
}
