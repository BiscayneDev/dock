// Pure formatting + diff helpers for the Knowledge surface. No React imports so
// these stay trivially testable.

export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === "string" && e.trim()) return e
  return fallback
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "—"
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(t).toLocaleDateString()
}

export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return String(iso)
  return new Date(t).toLocaleString()
}

export function truncateMiddle(value: string | null | undefined, keep = 8): string {
  if (!value) return "—"
  if (value.length <= keep * 2 + 1) return value
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}

/** Normalise trust-tier spellings ("machine_confirmed", "Human Reviewed"). */
export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-")
}

export interface BadgeStyle {
  color: string
  label: string
}

export const TRUST_TIERS: Record<string, BadgeStyle> = {
  unverified: { color: "#8b8fa3", label: "Unverified" },
  "machine-confirmed": { color: "#60a5fa", label: "Machine-confirmed" },
  "human-reviewed": { color: "#4ade80", label: "Human-reviewed" },
}

export const FRESHNESS: Record<string, BadgeStyle> = {
  fresh: { color: "#4ade80", label: "Fresh" },
  stale: { color: "#fbbf24", label: "Stale" },
}

export const DOC_STATUSES: Record<string, BadgeStyle> = {
  active: { color: "#4ade80", label: "Active" },
  stale: { color: "#fbbf24", label: "Stale" },
  superseded: { color: "#a78bfa", label: "Superseded" },
}

export const KNOWLEDGE_TYPES: Record<string, BadgeStyle> = {
  skill: { color: "#a78bfa", label: "Skill" },
  domain: { color: "#60a5fa", label: "Domain" },
  data_access: { color: "#2dd4bf", label: "Data access" },
  "data-access": { color: "#2dd4bf", label: "Data access" },
}

export const FLAG_KINDS: Record<string, BadgeStyle> = {
  missing: { color: "#f87171", label: "Missing" },
  wrong: { color: "#fbbf24", label: "Wrong" },
  stale: { color: "#c084fc", label: "Stale" },
}

export const PROPOSAL_STATUSES: Record<string, BadgeStyle> = {
  pending: { color: "#e7c979", label: "Pending" },
  approved: { color: "#4ade80", label: "Approved" },
  applied: { color: "#4ade80", label: "Applied" },
  rejected: { color: "#8b8fa3", label: "Rejected" },
  conflict: { color: "#f87171", label: "Conflict" },
  conflicted: { color: "#f87171", label: "Conflicted" },
}

export function badgeFor(
  map: Record<string, BadgeStyle>,
  value: string | null | undefined,
  fallbackLabel?: string,
): BadgeStyle {
  const key = normalizeKey(value)
  if (map[key]) return map[key]
  const raw = (value ?? "").trim()
  return { color: "#8b8fa3", label: fallbackLabel ?? (raw || "Unknown") }
}

export function trustBadge(tier: string | null | undefined): BadgeStyle {
  return badgeFor(TRUST_TIERS, tier)
}

export function freshnessBadge(doc: { status?: string | null; freshness?: string | null; staleAfter?: string | null }): BadgeStyle {
  const declared = normalizeKey(doc.freshness)
  if (FRESHNESS[declared]) return FRESHNESS[declared]
  if (doc.status && normalizeKey(doc.status) === "stale") return FRESHNESS.stale
  if (doc.staleAfter) {
    const t = Date.parse(doc.staleAfter)
    if (!Number.isNaN(t) && t < Date.now()) return FRESHNESS.stale
  }
  return FRESHNESS.fresh
}

export function typeBadge(type: string | null | undefined): BadgeStyle {
  return badgeFor(KNOWLEDGE_TYPES, type)
}

export function flagKindBadge(kind: string | null | undefined): BadgeStyle {
  return badgeFor(FLAG_KINDS, kind)
}

export function proposalStatusBadge(status: string | null | undefined): BadgeStyle {
  return badgeFor(PROPOSAL_STATUSES, status)
}

export function isPending(status: string | null | undefined): boolean {
  return normalizeKey(status) === "pending" || !status
}

// ── Values / diffs ────────────────────────────────────────────────────────────

export function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function stableStringify(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(rec).sort()) out[key] = rec[key]
  try {
    return JSON.stringify(out, null, 2)
  } catch {
    return String(value)
  }
}

export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  if (Array.isArray(value)) return value.map((v) => valueToText(v)).filter(Boolean).join(", ")
  return stableStringify(value) ?? String(value)
}

export interface FieldDiffRow {
  field: string
  before: string
  after: string
  changed: boolean
}

export function fieldDiffRows(before: unknown, after: unknown): FieldDiffRow[] {
  const b = asPlainRecord(before)
  const a = asPlainRecord(after)
  if (!b && !a) return []
  const keys = Array.from(new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])).sort()
  return keys.map((field) => {
    const bv = b ? b[field] : undefined
    const av = a ? a[field] : undefined
    const bt = valueToText(bv)
    const at = valueToText(av)
    return { field, before: bt, after: at, changed: bt !== at }
  })
}

export interface DiffRow {
  kind: "same" | "add" | "del"
  text: string
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n")
}

/** Line-level LCS diff. Falls back to a plain before/after pair when huge. */
export function lineDiff(before: string, after: string, maxLines = 600): DiffRow[] {
  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length > maxLines || b.length > maxLines) {
    return [
      { kind: "del", text: before.trim() },
      { kind: "add", text: after.trim() },
    ]
  }
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", text: a[i] })
      i += 1
    } else {
      rows.push({ kind: "add", text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ kind: "del", text: a[i] })
    i += 1
  }
  while (j < m) {
    rows.push({ kind: "add", text: b[j] })
    j += 1
  }
  return rows
}

export function demotionCopy(demotion: unknown): string | null {
  if (!demotion) return null
  if (typeof demotion === "string") return demotion.trim() || null
  if (typeof demotion === "boolean") {
    return "Approving edits a human-reviewed document: its trust tier drops to machine-confirmed until a human re-reviews it."
  }
  if (Array.isArray(demotion)) {
    const parts = demotion.map((d) => demotionCopy(d)).filter((s): s is string => !!s)
    return parts.length ? parts.join(" ") : null
  }
  const rec = asPlainRecord(demotion)
  if (rec) {
    const explicit = valueToText(rec.message ?? rec.reason).trim()
    if (explicit) return explicit
    const from = valueToText(rec.from ?? rec.fromTier ?? rec.current ?? "human-reviewed").trim() || "human-reviewed"
    const to = valueToText(rec.to ?? rec.toTier ?? rec.next ?? "machine-confirmed").trim() || "machine-confirmed"
    return `Approval demotes this document from ${from} to ${to}; it needs human re-review to regain the higher tier.`
  }
  return null
}

export function conflictEntries(conflicts: unknown): string[] {
  if (!conflicts) return []
  if (typeof conflicts === "string") return conflicts.trim() ? [conflicts.trim()] : []
  if (Array.isArray(conflicts)) {
    return conflicts
      .map((entry) => {
        if (typeof entry === "string") return entry.trim()
        const rec = asPlainRecord(entry)
        if (!rec) return valueToText(entry).trim()
        const target = valueToText(rec.docId ?? rec.docPath ?? rec.path ?? rec.document).trim()
        const reason = valueToText(rec.reason ?? rec.message ?? rec.detail).trim()
        const other = valueToText(rec.otherProposalId ?? rec.conflictsWith ?? rec.proposalId).trim()
        return [target, reason, other].filter(Boolean).join(" · ") || valueToText(entry).trim()
      })
      .filter(Boolean)
  }
  const rec = asPlainRecord(conflicts)
  if (rec) {
    if (Array.isArray(rec.items)) return conflictEntries(rec.items)
    const message = valueToText(rec.message ?? rec.reason).trim()
    if (message) return [message]
    const count = valueToText(rec.count).trim()
    if (count) return [`${count} conflicting edit(s)`]
  }
  return []
}

export function listOrEmpty(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : []
}

export function countOf(value: number | unknown[] | undefined | null): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.length
  return 0
}
