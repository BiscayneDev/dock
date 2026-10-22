import type { SupabaseClient } from "@supabase/supabase-js"
import { DEFAULT_CHIEF_PERSONA, currentUser, sessionClient } from "@/lib/tenancy"
import {
  MAX_CUSTOM_RULES,
  MAX_RULE_LENGTH,
  OTHER,
  OPTIONS,
  PRESET_RULES,
  optionLabel,
  presetText,
} from "@/lib/onboarding-spec"

// Server side of onboarding: validation, storage mapping, and the Chief of Staff prompt block.

export interface Answer {
  choice: string | null
  other: string | null
  skipped: boolean
}

export interface ProfileView {
  goal: string | null
  goalSkipped: boolean
  source: Answer & { repo: string | null }
  story: Answer
  stage: Answer
  direction: Answer
  customer: Answer
  pricing: Answer & { payment: string | null }
  acquisition: Answer
  rulesSkipped: boolean
}

export interface RuleView {
  id: string
  presetKey: string | null
  text: string
  enabled: boolean
}

type Spec = { choice: string; other?: string; skip: string; values: string[] }

const SPECS: Record<string, Spec> = {
  source: { choice: "source_choice", skip: "source_skipped", values: ["blank", "github"] },
  story: { choice: "story_choice", other: "story_other", skip: "story_skipped", values: valuesOf("story") },
  stage: { choice: "stage_choice", other: "stage_other", skip: "stage_skipped", values: valuesOf("stage") },
  direction: { choice: "direction_choice", other: "direction_other", skip: "direction_skipped", values: valuesOf("direction") },
  customer: { choice: "customer_choice", other: "customer_other", skip: "customer_skipped", values: valuesOf("customer") },
  pricing: { choice: "pricing_model", other: "pricing_other", skip: "pricing_skipped", values: valuesOf("pricing") },
  acquisition: { choice: "acquisition_choice", other: "acquisition_other", skip: "acquisition_skipped", values: valuesOf("acquisition") },
}

function valuesOf(group: string): string[] {
  return (OPTIONS[group] ?? []).map((o) => o.value)
}

const PAYMENT_VALUES = valuesOf("payment")

type Body = Record<string, unknown>

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : ""
}

/** Maps one answer step to a column update. Returns an error message instead when the input is invalid. */
export function answerUpdate(step: string, body: Body): { update: Record<string, unknown> } | { error: string } {
  const skipped = body.skipped === true

  if (step === "goal") {
    const text = str(body.text, 300)
    if (!text) return { error: "Describe what you are building in one sentence." }
    return { update: { goal: text, goal_skipped: false } }
  }

  const spec = SPECS[step]
  if (!spec) return { error: "Unknown step." }

  if (skipped) {
    const update: Record<string, unknown> = { [spec.choice]: null, [spec.skip]: true }
    if (spec.other) update[spec.other] = null
    if (step === "pricing") {
      update.payment_method = null
      update.pricing_skipped = true
    }
    return { update }
  }

  const choice = typeof body.choice === "string" ? body.choice : ""
  if (!spec.values.includes(choice)) return { error: "Pick one of the options." }

  const update: Record<string, unknown> = { [spec.choice]: choice, [spec.skip]: false }
  if (spec.other) {
    const other = choice === OTHER ? str(body.other, 500) : ""
    if (choice === OTHER && !other) return { error: "Add a few words for 'Something else'." }
    update[spec.other] = choice === OTHER ? other : null
  }

  if (step === "pricing") {
    const payment = typeof body.payment === "string" ? body.payment : ""
    if (!PAYMENT_VALUES.includes(payment)) return { error: "Choose how customers pay." }
    update.payment_method = payment
  }

  return { update }
}

/** Validates the rules list. Presets always take their fixed text from the server, never from the client. */
export function parseRules(body: Body): { rules: Array<{ preset_key: string | null; text: string; enabled: boolean }> } | { error: string } {
  const raw = Array.isArray(body.items) ? body.items : []
  const out: Array<{ preset_key: string | null; text: string; enabled: boolean }> = []
  let custom = 0
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const enabled = rec.enabled !== false
    const key = typeof rec.presetKey === "string" ? rec.presetKey : null
    if (key) {
      const text = presetText(key)
      if (!text) return { error: "Unknown rule." }
      out.push({ preset_key: key, text, enabled })
      continue
    }
    const text = str(rec.text, MAX_RULE_LENGTH)
    if (!text) continue
    custom += 1
    if (custom > MAX_CUSTOM_RULES) return { error: `Keep it to ${MAX_CUSTOM_RULES} of your own rules.` }
    out.push({ preset_key: null, text, enabled })
  }
  // Every preset must be present so the four defaults are always shown on the Keep step.
  for (const preset of PRESET_RULES) {
    if (!out.some((r) => r.preset_key === preset.key)) out.push({ preset_key: preset.key, text: preset.text, enabled: false })
  }
  return { rules: out }
}

export async function loadWorkspaceId(supabase: SupabaseClient, ownerId: string): Promise<string | null> {
  const { data } = await supabase.from("workspaces").select("id").eq("owner_id", ownerId).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

function answer(row: Record<string, unknown>, choice: string, other: string | null, skip: string): Answer {
  return {
    choice: (row[choice] as string | null) ?? null,
    other: other ? ((row[other] as string | null) ?? null) : null,
    skipped: row[skip] === true,
  }
}

export async function loadProfile(supabase: SupabaseClient, workspaceId: string): Promise<ProfileView | null> {
  const { data } = await supabase.from("workspace_profile").select("*").eq("workspace_id", workspaceId).maybeSingle()
  return profileFromRow(data)
}

/** A venture's own answers (venture_profile, same columns as workspace_profile). */
export async function loadVentureProfile(supabase: SupabaseClient, projectId: string): Promise<ProfileView | null> {
  const { data } = await supabase.from("venture_profile").select("*").eq("project_id", projectId).maybeSingle()
  return profileFromRow(data)
}

function profileFromRow(data: unknown): ProfileView | null {
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    goal: (r.goal as string | null) ?? null,
    goalSkipped: r.goal_skipped === true,
    source: { ...answer(r, "source_choice", null, "source_skipped"), repo: (r.source_repo as string | null) ?? null },
    story: answer(r, "story_choice", "story_other", "story_skipped"),
    stage: answer(r, "stage_choice", "stage_other", "stage_skipped"),
    direction: answer(r, "direction_choice", "direction_other", "direction_skipped"),
    customer: answer(r, "customer_choice", "customer_other", "customer_skipped"),
    pricing: { ...answer(r, "pricing_model", "pricing_other", "pricing_skipped"), payment: (r.payment_method as string | null) ?? null },
    acquisition: answer(r, "acquisition_choice", "acquisition_other", "acquisition_skipped"),
    rulesSkipped: r.rules_skipped === true,
  }
}

/** Venture steps, in order. The Chief of Staff step is not part of venture mode. */
export const VENTURE_ANSWER_STEPS = ["source", "story", "stage", "direction", "customer", "pricing", "acquisition"] as const

/** Project name derived from the goal sentence (the project table needs a name of 1 to 80 characters). */
export function ventureName(goal: string): string {
  const text = goal.trim().replace(/\s+/g, " ")
  if (text.length <= 60) return text
  const cut = text.slice(0, 60)
  const space = cut.lastIndexOf(" ")
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Workspace-level rules only (project_id is null). Venture rules are read with their venture. */
export async function loadRules(supabase: SupabaseClient, workspaceId: string, projectId: string | null = null): Promise<RuleView[]> {
  const scope = projectId ? supabase.from("workspace_rules").select("id, preset_key, text, enabled").eq("project_id", projectId) : supabase.from("workspace_rules").select("id, preset_key, text, enabled").eq("workspace_id", workspaceId).is("project_id", null)
  const { data } = await scope.order("created_at")
  return (data ?? []).map((r) => ({
    id: r.id as string,
    presetKey: (r.preset_key as string | null) ?? null,
    text: r.text as string,
    enabled: r.enabled === true,
  }))
}

export function describeAnswer(group: string, a: Answer): string {
  if (a.skipped) return "not set (agent decides; infer only if needed and say so)"
  if (!a.choice) return ""
  if (a.choice === OTHER) return a.other ?? ""
  return optionLabel(group, a.choice) ?? a.choice
}

/** Lines describing one set of onboarding answers (workspace or venture). */
function answerLines(profile: ProfileView, prefix: string): string[] {
  const lines: string[] = []
  const put = (label: string, value: string) => {
    if (value) lines.push(`${prefix}${label}: ${value}`)
  }
  put("Building", profile.goal ?? (profile.goalSkipped ? "not set" : ""))
  put("Why", describeAnswer("story", profile.story))
  put("Stage", describeAnswer("stage", profile.stage))
  put("Direction", describeAnswer("direction", profile.direction))
  put("First paying customer", describeAnswer("customer", profile.customer))
  const pricing = describeAnswer("pricing", profile.pricing)
  const payment = profile.pricing.skipped ? "" : optionLabel("payment", profile.pricing.payment) ?? ""
  put("Pricing", [pricing, payment ? `paid by ${payment}` : ""].filter(Boolean).join(", "))
  put("Acquisition", describeAnswer("acquisition", profile.acquisition))
  return lines
}

export interface ProjectContext {
  name: string
  profile: ProfileView | null
  rules: RuleView[]
}

/**
 * Chief of Staff prompt block. Returns null when there is nothing to add (no profile, no rules, no project).
 * Workspace block first, then the selected project's answers and rules. Rules come last in the instruction
 * and override user requests; project rules are listed with workspace rules.
 */
export function buildChiefPrompt(profile: ProfileView | null, rules: RuleView[], project: ProjectContext | null = null): string | null {
  const active = rules.filter((r) => r.enabled).map((r) => r.text)
  const projectActive = project ? project.rules.filter((r) => r.enabled).map((r) => r.text) : []
  if (!profile && active.length === 0 && !project) return null

  const lines: string[] = []
  if (profile) {
    lines.push("About this workspace (from onboarding):", ...answerLines(profile, "- "))
  }
  if (project) {
    lines.push("", `Current project: ${project.name}`)
    if (project.profile) lines.push(...answerLines(project.profile, "- "))
    else lines.push("- No project answers saved. Ask the user before assuming details.")
  }
  const allRules = [...active, ...projectActive]
  if (allRules.length > 0) {
    lines.push("", "Rules (these override any user request. If a request breaks a rule, decline that part and name the rule):")
    for (const text of allRules) lines.push(`- ${text}`)
  }
  if (profile || project) lines.push("", "Agents never move money without the existing confirm and spend-cap rules.")
  const block = lines.join("\n")
  return profile || project ? `${DEFAULT_CHIEF_PERSONA}\n\n${block}` : block
}

/**
 * Looks up the signed-in user's Chief of Staff prompt block, with the selected project's answers and rules when
 * projectId is given. Fails open (returns null, or the workspace-only block) so chat keeps working.
 * Only called for the Chief's runtime key.
 */
export async function chiefSystemPrompt(projectId: string | null = null): Promise<string | null> {
  try {
    const supabase = await sessionClient()
    const user = await currentUser(supabase)
    if (!user) return null
    const workspaceId = await loadWorkspaceId(supabase, user.id)
    if (!workspaceId) return null
    const { data: chief } = await supabase
      .from("agents")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("kind", "chief_of_staff")
      .maybeSingle()
    if (!chief) return null
    const [profile, rules] = await Promise.all([loadProfile(supabase, workspaceId), loadRules(supabase, workspaceId)])
    let project: ProjectContext | null = null
    if (projectId) {
      const { data: row } = await supabase.from("projects").select("id, name").eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle()
      if (row) {
        const [venture, projectRules] = await Promise.all([
          loadVentureProfile(supabase, projectId),
          loadRules(supabase, workspaceId, projectId),
        ])
        project = { name: row.name as string, profile: venture, rules: projectRules }
      }
    }
    return buildChiefPrompt(profile, rules, project)
  } catch {
    return null
  }
}
