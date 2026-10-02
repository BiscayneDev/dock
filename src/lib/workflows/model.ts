/**
 * Chat-taught workflows (pure logic, no I/O). A workflow is a name, plain-text
 * steps the user was shown, and the sites it needs (read-only). It can never do
 * more than the capabilities its owner has connected, and widening what it
 * needs re-asks. Steps only come from the user's own messages via the save
 * draft; nothing a page says is ever written here.
 */
import { isDenied, normalizeSite } from '@/lib/browser-sessions/policy'

export interface WorkflowDef {
  name: string
  steps: string[]
  /** Sites needed, each read-only. v1 runs support at most one. */
  needs: string[]
}

export const MAX_STEPS = 12
export const MAX_STEP_CHARS = 300
export const MAX_NAME_CHARS = 60

/** Things a workflow must never do, even if granted. */
const FORBIDDEN_STEP = /\b(send|reply|forward|email|text|message|dm|post|tweet)\b.*\b(as me|from me|to (him|her|them|everyone|anyone)|on my behalf)\b|\b(pay|purchase|buy|checkout|transfer|wire|withdraw|order)\b|\b(change|update|edit|delete|close|cancel)\b.*\b(setting|password|account|subscription|email address)\b|\bpassword|cookie|2fa|verification code\b/i

export function cleanName(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_CHARS)
}

export function validateWorkflow(input: { name?: unknown; steps?: unknown; needs?: unknown }): { ok: true; def: WorkflowDef } | { ok: false; error: string } {
  const name = cleanName(input.name)
  if (!name) return { ok: false, error: 'a workflow needs a short name' }
  const steps = (Array.isArray(input.steps) ? input.steps : []).map((s) => String(s ?? '').trim()).filter(Boolean)
  if (!steps.length) return { ok: false, error: 'a workflow needs at least one step, in the user\'s own words' }
  if (steps.length > MAX_STEPS) return { ok: false, error: `keep it to ${MAX_STEPS} steps or fewer` }
  if (steps.some((s) => s.length > MAX_STEP_CHARS)) return { ok: false, error: `each step must be under ${MAX_STEP_CHARS} characters` }
  const bad = steps.find((s) => FORBIDDEN_STEP.test(s))
  if (bad) {
    return {
      ok: false,
      error: `Workflows are read-only: they never send as the user, spend money, change settings or handle passwords and codes. Step "${bad.slice(0, 80)}" crosses that line. Offer to keep the read-only part and let them do that step themselves.`,
    }
  }
  const needs: string[] = []
  for (const raw of Array.isArray(input.needs) ? input.needs : []) {
    const site = normalizeSite(String(raw ?? ''))
    if (!site) return { ok: false, error: `"${String(raw)}" does not look like a website` }
    if (isDenied(site)) return { ok: false, error: `${site} is a site Dinghy keeps out of logged-in sessions, so a workflow cannot need it` }
    if (!needs.includes(site)) needs.push(site)
  }
  if (needs.length > 1) return { ok: false, error: 'a workflow can use one connected site for now' }
  return { ok: true, def: { name, steps, needs } }
}

/** The exact text the user confirms, rendered by the server. */
export function renderWorkflowDraft(def: WorkflowDef, replacing: boolean): string {
  const steps = def.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const needs = def.needs.length ? `Uses your logged-in ${def.needs.join(', ')} session, read-only.` : 'Uses the public web only.'
  return `${replacing ? 'Replace' : 'Save'} "${def.name}"?\n\n${steps}\n\n${needs} It never sends as you, spends money or changes settings, and each run still asks for your yes. Say "forget ${def.name}" to remove it.\n\nReply Y to save, N to cancel.`
}

/** The task text a run hands to the browse tool. */
export function runTask(def: WorkflowDef): string {
  return `Run my saved workflow "${def.name}" step by step, read-only:\n${def.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
}

export type RunPlan = { ok: true; site: string | null } | { ok: false; error: string }

/** Fail closed: every need must be a live connection, or the run does not start. */
export function planRun(def: WorkflowDef, liveSites: string[]): RunPlan {
  const missing = def.needs.filter((n) => !liveSites.includes(n))
  if (missing.length) {
    return { ok: false, error: `"${def.name}" needs your ${missing.join(', ')} login, which isn't connected anymore. Offer browser_connect for ${missing[0]} so they can reconnect it; nothing ran.` }
  }
  return { ok: true, site: def.needs[0] ?? null }
}

/** Needs may not widen without a new draft; this says whether two defs differ in what they touch. */
export function needsChanged(a: WorkflowDef, b: WorkflowDef): boolean {
  return a.needs.slice().sort().join(',') !== b.needs.slice().sort().join(',')
}

export function defFromScope(label: string, scope: Record<string, unknown>): WorkflowDef {
  return {
    name: label,
    steps: Array.isArray(scope.steps) ? scope.steps.map(String) : [],
    needs: Array.isArray(scope.needs) ? scope.needs.map(String) : [],
  }
}
