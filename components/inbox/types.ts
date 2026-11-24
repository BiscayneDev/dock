import type { InboxItem } from "@/lib/inbox-query"

export interface VerdictView {
  id: string
  decisionId: string
  actorId: string | null
  verdict: string
  status: string
  artifactHash: string
  reason: string | null
  note: string | null
  createdAt: string
}

/** An inbox row as serialized by GET /api/inbox. */
export type InboxCardItem = InboxItem & {
  raw: Record<string, unknown> & { verdicts?: VerdictView[]; options?: Array<{ id: string; label: string; description?: string }> }
}

export interface InboxCounts {
  all: number
  "needs-you": number
  running: number
  done: number
}

export interface InboxResponse {
  emails?: unknown[]
  items: InboxCardItem[]
  counts: InboxCounts
  filter: string
  signedIn: boolean
  sources: Record<string, boolean>
}
