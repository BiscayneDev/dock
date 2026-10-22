"use client"

import { useEffect, useState } from "react"
import type { Toast } from "@/lib/useToast"

const AGENT_CONFIG: Record<string, { color: string; emoji: string; label: string }> = {
  scout: { color: "#06b6d4", emoji: "🔭", label: "Scout" },
  builder: { color: "#10b981", emoji: "⚡", label: "Builder" },
  "deal-flow": { color: "#f59e0b", emoji: "🤝", label: "Deal Flow" },
  baron: { color: "#ec4899", emoji: "🏦", label: "Baron" },
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast
  onRemove: (id: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const agentKey = toast.agent.toLowerCase().replace(/\s+/g, "-")
  const config = AGENT_CONFIG[agentKey] ?? {
    color: "#6b7280",
    emoji: "🤖",
    label: toast.agent,
  }

  useEffect(() => {
    // Trigger slide-in on mount
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  return (
    <div
      style={{
        backgroundColor: "#111118",
        borderLeft: `3px solid ${config.color}`,
        transform: visible ? "translateX(0)" : "translateX(120%)",
        transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)`,
      }}
      className="w-80 rounded-lg overflow-hidden pointer-events-auto"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <span className="text-lg leading-none mt-0.5">{config.emoji}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-semibold tracking-wide uppercase"
                  style={{ color: config.color }}
                >
                  {config.label}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatTime(toast.timestamp)}
                </span>
              </div>
              <p className="text-sm text-zinc-300 leading-snug break-words">
                {toast.message}
              </p>
            </div>
          </div>
          <button
            onClick={() => onRemove(toast.id)}
            className="text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0 mt-0.5"
            aria-label="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[]
  onRemove: (id: string) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}
