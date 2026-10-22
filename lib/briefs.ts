/**
 * Project briefs and the work ledger (central thread spec, v1). Pure functions only: no I/O and no
 * imports, so the node tests can load this file directly (see test/briefs.test.mjs).
 *
 * Rules enforced here:
 *  - Only an approved brief can create a run. Chat text, @mentions and model output never spawn work.
 *  - The chief of staff proposes work by emitting a fenced ```brief JSON block. The server validates it.
 *  - Every brief has a hard budget cap; the run inherits it.
 */

export const BRIEF_STATES = ["proposed", "approved", "running", "succeeded", "failed", "cancelled"] as const
export type BriefState = (typeof BRIEF_STATES)[number]

export const RISK_FLAGS = ["spends_money", "contacts_people", "publishes_externally", "deletes_data"] as const
export type RiskFlag = (typeof RISK_FLAGS)[number]

export const LEDGER_KINDS = [
  "brief_proposed",
  "brief_cancelled",
  "run_started",
  "run_succeeded",
  "run_failed",
] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

export const BRIEF_GOAL_MAX = 280
export const BRIEF_CONTEXT_MAX = 2000
export const BRIEF_DELIVERABLES_MAX = 8
export const BRIEF_DELIVERABLE_MAX = 200
export const DEFAULT_BRIEF_BUDGET_CENTS = 100
const AGENT_KEY = /^[a-z0-9_-]{1,64}$/

export interface BriefProposal {
  goal: string
  context: string
  deliverables: string[]
  budgetCents: number
  agentKey: string | null
  riskFlags: RiskFlag[]
}

export interface ParsedBriefs {
  /** Assistant text with every brief block removed. This is what the thread shows. */
  text: string
  /** Valid proposals in the order they appeared. Invalid blocks are dropped, not guessed at. */
  proposals: BriefProposal[]
  /** Reasons for blocks that were dropped. Surfaced to the model/log, never to spend. */
  rejected: string[]
}

const BLOCK = /```brief[ \t]*\r?\n([\s\S]*?)```/g

/** Removes complete brief blocks and any unfinished one still streaming. Safe for live display. */
export function stripBriefBlocks(text: string): string {
  const closed = text.replace(BLOCK, "")
  const open = closed.indexOf("```brief")
  return (open === -1 ? closed : closed.slice(0, open)).replace(/\n{3,}/g, "\n\n").trim()
}

/** Derives risk flags from the brief's own words. The model may under-report; this is a floor. */
export function detectRiskFlags(text: string): RiskFlag[] {
  const t = text.toLowerCase()
  const flags: RiskFlag[] = []
  if (/\b(pay|payment|buy|purchase|spend|invoice|refund|ads?|budget|charge|checkout)\b/.test(t)) flags.push("spends_money")
  if (/\b(email|e-mail|outreach|dm|message|contact|cold|reply to)\b/.test(t)) flags.push("contacts_people")
  if (/\b(publish|post|deploy|launch|tweet|announce|release)\b/.test(t)) flags.push("publishes_externally")
  if (/\b(delete|remove|drop|wipe|purge)\b/.test(t)) flags.push("deletes_data")
  return flags
}

function asStringArray(value: unknown, maxItems: number, maxLen: number): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, maxLen))
    .filter((v) => v.length > 0)
  if (items.length === 0 || items.length > maxItems) return null
  return items
}

/** Validates one parsed brief object. Returns a proposal or a human-readable rejection reason. */
export function validateBrief(raw: unknown, maxBudgetCents: number): BriefProposal | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "brief is not an object"
  const b = raw as Record<string, unknown>

  const goal = typeof b.goal === "string" ? b.goal.trim() : ""
  if (!goal) return "brief has no goal"
  if (goal.length > BRIEF_GOAL_MAX) return "goal is too long"

  const deliverables = asStringArray(b.deliverables, BRIEF_DELIVERABLES_MAX, BRIEF_DELIVERABLE_MAX)
  if (!deliverables) return "brief needs 1 to 8 deliverables"

  const context = typeof b.context === "string" ? b.context.trim().slice(0, BRIEF_CONTEXT_MAX) : ""

  let budgetCents = DEFAULT_BRIEF_BUDGET_CENTS
  if (b.budget_cents !== undefined) {
    if (typeof b.budget_cents !== "number" || !Number.isInteger(b.budget_cents) || b.budget_cents < 1) {
      return "budget_cents must be a positive integer"
    }
    // Clamp rather than reject: the model proposes, the server caps.
    budgetCents = Math.min(b.budget_cents, maxBudgetCents)
  }

  let agentKey: string | null = null
  if (b.agent !== undefined && b.agent !== null) {
    if (typeof b.agent !== "string" || !AGENT_KEY.test(b.agent)) return "agent is not a valid key"
    agentKey = b.agent
  }

  const declared = Array.isArray(b.risk_flags)
    ? b.risk_flags.filter((f): f is RiskFlag => typeof f === "string" && (RISK_FLAGS as readonly string[]).includes(f))
    : []
  const riskFlags = Array.from(new Set<RiskFlag>([...declared, ...detectRiskFlags(`${goal} ${deliverables.join(" ")} ${context}`)]))

  return { goal, context, deliverables, budgetCents, agentKey, riskFlags }
}

/** Finds every ```brief block, validates it, and returns the cleaned text. */
export function parseBriefBlocks(text: string, maxBudgetCents: number): ParsedBriefs {
  const proposals: BriefProposal[] = []
  const rejected: string[] = []
  for (const match of text.matchAll(BLOCK)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1])
    } catch {
      rejected.push("brief block is not valid JSON")
      continue
    }
    const result = validateBrief(parsed, maxBudgetCents)
    if (typeof result === "string") rejected.push(result)
    else proposals.push(result)
  }
  return { text: stripBriefBlocks(text), proposals, rejected }
}

/**
 * Detects a leading @mention of a roster agent. Matching is case-insensitive against each agent's
 * display name (spaces removed) and runtime key. Unknown mentions are left in the text untouched.
 */
export function parseMention(
  text: string,
  roster: Array<{ key: string; displayName: string }>,
): { agentKey: string | null; text: string } {
  const m = /^\s*@([A-Za-z0-9_-]{1,64})\b[:,]?\s*/.exec(text)
  if (!m) return { agentKey: null, text }
  const token = m[1].toLowerCase()
  const hit = roster.find(
    (a) => a.key.toLowerCase() === token || a.displayName.replace(/\s+/g, "").toLowerCase() === token,
  )
  if (!hit) return { agentKey: null, text }
  return { agentKey: hit.key, text: text.slice(m[0].length).trim() }
}

export interface RosterEntry {
  key: string
  displayName: string
  isChief: boolean
}

/** The workspace's chief of staff: the agent flagged as chief, else the first roster entry, else null. No name is assumed. */
export function pickChief(roster: RosterEntry[]): RosterEntry | null {
  return roster.find((a) => a.isChief) ?? roster[0] ?? null
}

/** Only `proposed` briefs can be approved or cancelled. Everything else is terminal or already running. */
export function canApprove(state: BriefState): boolean {
  return state === "proposed"
}
export function canCancel(state: BriefState): boolean {
  return state === "proposed"
}

/** Maps a finished run's status to the brief state and the ledger kind written for it. */
export function outcomeForRun(status: "succeeded" | "failed" | "cancelled"): {
  briefState: BriefState
  ledgerKind: LedgerKind
} {
  if (status === "succeeded") return { briefState: "succeeded", ledgerKind: "run_succeeded" }
  return { briefState: "failed", ledgerKind: "run_failed" }
}

/** The prompt a subagent receives for an approved brief. Deliverables and limits are explicit. */
export function composeRunPrompt(brief: {
  goal: string
  context: string
  deliverables: string[]
  budgetCents: number
  riskFlags: RiskFlag[]
}): string {
  const lines = [`Goal: ${brief.goal}`]
  if (brief.context) lines.push("", "Context:", brief.context)
  lines.push("", "Deliverables:", ...brief.deliverables.map((d, i) => `${i + 1}. ${d}`))
  lines.push(
    "",
    `Budget: ${(brief.budgetCents / 100).toFixed(2)} USD. Stop and report if you cannot finish within it.`,
  )
  if (brief.riskFlags.length > 0) {
    lines.push(`The owner approved this knowing it may: ${brief.riskFlags.join(", ").replace(/_/g, " ")}.`)
  }
  lines.push("", "Report what you produced, what you checked, and anything left undone.")
  return lines.join("\n")
}

/** System-prompt block that teaches the chief of staff the brief protocol. Appended for project chats. */
export const BRIEF_PROTOCOL_PROMPT = `
You work inside a project's central thread. Chat, questions and discussion happen here freely.
Real work (building, writing, researching, sending, publishing, changing anything, spending money) must
never start from chat. Instead, when the owner asks for real work, reply in one or two sentences and then
append exactly one fenced block tagged brief, containing JSON and nothing else:

\`\`\`brief
{"goal": "one sentence", "context": "what the agent needs to know", "deliverables": ["concrete output 1", "concrete output 2"], "budget_cents": 100, "agent": "optional agent key"}
\`\`\`

Rules: deliverables are concrete and checkable. Keep budget_cents as small as the job allows. Do not
claim the work is done or started. The owner approves the brief before anything runs. If the request is
a question, answer it and do not emit a brief.`

// ── Project monthly spend cap ───────────────────────────────────────────────

export const MAX_MONTHLY_CAP_CENTS = 1_000_000

/** Start of the UTC calendar month containing `now`. The cap window resets here. */
export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/**
 * Validates a cap set by the owner. null clears the cap (no limit). Otherwise a whole number of cents, 0 to $10,000.
 * Returns the cents or an error string.
 */
export function validateCapCents(raw: unknown): number | null | string {
  if (raw === null) return null
  if (typeof raw !== "number" || !Number.isInteger(raw)) return "capCents must be a whole number of cents or null"
  if (raw < 0 || raw > MAX_MONTHLY_CAP_CENTS) return `capCents must be between 0 and ${MAX_MONTHLY_CAP_CENTS}`
  return raw
}

export interface CapCheck {
  ok: boolean
  capCents: number | null
  /** Spend already recorded this month (finished runs). */
  spentCents: number
  /** Budgets of approved and running briefs, including the one being checked. */
  reservedCents: number
  /** Cap minus spent and reserved. Null when there is no cap. Negative means over. */
  remainingCents: number | null
}

/**
 * Monthly cap check. Run after the brief is flipped to approved, so its own budget is inside `reservedCents`.
 * No cap always passes. Otherwise spent + reserved must fit under the cap.
 */
export function checkMonthlyCap(input: { capCents: number | null; spentCents: number; reservedCents: number }): CapCheck {
  const { capCents, spentCents, reservedCents } = input
  if (capCents === null) return { ok: true, capCents, spentCents, reservedCents, remainingCents: null }
  const remainingCents = capCents - spentCents - reservedCents
  return { ok: remainingCents >= 0, capCents, spentCents, reservedCents, remainingCents }
}
