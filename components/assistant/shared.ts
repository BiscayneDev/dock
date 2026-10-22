import type { UIMessage } from "ai"

export interface ConversationSummary {
  id: string
  title: string
  agent: string
  updatedAt: string
  latestPreview: string
  /** Null = "No project". */
  projectId?: string | null
  projectName?: string | null
  /** False for older file-based chats: they stay under "No project" and cannot be moved. */
  editable?: boolean
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    id: string
    role: "user" | "assistant" | "agent"
    text: string
    agent: string
    timestamp: number
    runId?: string
    meta?: Record<string, unknown>
  }>
}

/** A project the user can attach a conversation to (from /api/workspace). */
export interface ProjectOption {
  id: string
  name: string
}

export interface AgentDef {
  id: string
  name: string
  emoji: string
  accent: string
  description: string
}

// Fallback roster; the live list comes from /api/agents.
export const AGENTS: AgentDef[] = [
  { id: "vic", name: "Vic", emoji: "🦞", accent: "#7c3aed", description: "Chief of Staff" },
  { id: "scout", name: "Scout", emoji: "🔭", accent: "#06b6d4", description: "Market Intel" },
  { id: "builder", name: "Builder", emoji: "⚡", accent: "#10b981", description: "Full-Stack Dev" },
  { id: "baron", name: "Baron", emoji: "🏦", accent: "#ec4899", description: "The Banker" },
  { id: "deal-flow", name: "Deal Flow", emoji: "🤝", accent: "#f59e0b", description: "Partnership Radar" },
]

export function relativeTime(value: string | number): string {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export function toInitialMessages(detail: ConversationDetail | null): UIMessage[] {
  if (!detail) return []
  return detail.messages.map((message) => ({
    id: message.id,
    role: message.role === "agent" ? "assistant" : message.role,
    parts: [{ type: "text", text: message.text }],
    metadata: {
      ...(message.runId ? { runId: message.runId } : {}),
      ...(Array.isArray(message.meta?.briefIds) ? { briefIds: message.meta.briefIds as string[] } : {}),
      ...(typeof message.meta?.kind === "string" ? { kind: message.meta.kind as string } : {}),
    },
  })) as UIMessage[]
}

export function getText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
}

export function greetingFor(name?: string): string {
  const hour = new Date().getHours()
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"
  return name ? `Good ${part}, ${name}` : `Good ${part}`
}
