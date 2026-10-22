// Onboarding question set (pure data, safe to import from client and server).
// Ten questions plus the review screen. Each question has a Skip path that stores null with skipped=true.

export type StepKey =
  | "goal"
  | "source"
  | "story"
  | "stage"
  | "direction"
  | "customer"
  | "pricing"
  | "acquisition"
  | "rules"
  | "chief"
  | "review"

export interface Option {
  value: string
  label: string
  recommended?: boolean
  hint?: string
}

export const OTHER = "something_else"

export const STEP_ORDER: StepKey[] = [
  "goal",
  "source",
  "story",
  "stage",
  "direction",
  "customer",
  "pricing",
  "acquisition",
  "rules",
  "chief",
  "review",
]

// Steps that can be skipped with "Skip: agent decides". Goal is required; the Chief of Staff name is required.
export const SKIPPABLE: StepKey[] = ["source", "story", "stage", "direction", "customer", "pricing", "acquisition", "rules"]

export const STEP_TITLES: Record<StepKey, string> = {
  goal: "What are you building, in one sentence?",
  source: "Where does the work start?",
  story: "Why are you building it?",
  stage: "Where is it today?",
  direction: "What should happen to the idea?",
  customer: "Who is the first paying customer?",
  pricing: "How will it charge, and how do customers pay?",
  acquisition: "How will the first hundred users hear about it?",
  rules: "Keep these rules",
  chief: "Name your Chief of Staff",
  review: "Review and confirm",
}

export const OPTIONS: Record<string, Option[]> = {
  source: [
    { value: "blank", label: "Start blank", recommended: true },
    {
      value: "github",
      label: "Import an existing GitHub repo as a copy",
      hint: "Your choice is saved. The import itself is not built yet, so you start blank for now.",
    },
  ],
  story: [
    { value: "own_frustration", label: "My own frustration" },
    { value: "agent_infra", label: "I build agent infrastructure" },
    { value: "friends_asked", label: "Friends kept asking" },
    { value: OTHER, label: "Something else" },
  ],
  stage: [
    { value: "just_me", label: "Just me" },
    { value: "few_users", label: "A few users" },
    { value: "nobody_yet", label: "Nobody yet" },
    { value: OTHER, label: "Something else" },
  ],
  direction: [
    { value: "carry_on", label: "Carry on as is", recommended: true },
    { value: "narrow", label: "Narrow it down (ask for the one job)" },
    { value: "rethink", label: "Rethink it (ask for the audience or use)" },
    { value: OTHER, label: "Something else" },
  ],
  customer: [
    { value: "busy_professional", label: "Busy professional" },
    { value: "small_business_owner", label: "Small business owner" },
    { value: "solo_founder", label: "Solo founder" },
    { value: OTHER, label: "Something else" },
  ],
  pricing: [
    { value: "subscription", label: "Monthly subscription" },
    { value: "usage_based", label: "Usage-based" },
    { value: "free_then_paid", label: "Free to start, then paid" },
    { value: OTHER, label: "Something else" },
  ],
  payment: [
    { value: "usdc", label: "USDC (crypto)", recommended: true },
    { value: "card", label: "Card via a payment provider" },
    { value: "both", label: "Both" },
  ],
  acquisition: [
    { value: "founder_social", label: "Founder social posts" },
    { value: "friends_referrals", label: "Friends and referrals" },
    { value: "paid_ads", label: "Paid ads" },
    { value: "communities", label: "Communities" },
    { value: OTHER, label: "Something else" },
  ],
}

export const PRESET_RULES: Array<{ key: string; text: string }> = [
  { key: "no_spend_without_approval", text: "Never spend money without my approval" },
  { key: "no_public_post_without_approval", text: "Never post publicly without my approval" },
  { key: "no_private_data_outside_workspace", text: "Never share customer or private data outside this workspace" },
  { key: "no_pricing_change_without_asking", text: "Never change pricing without asking" },
]

export const MAX_CUSTOM_RULES = 10
export const MAX_RULE_LENGTH = 300

export { DEFAULT_CHIEF_NAME } from "@/lib/chief-key"

export const PAYMENT_NOTE =
  "USDC payments touch money-transmission and consumer-protection rules. This needs legal review before launch. Agents never move money without your confirm and spend-cap rules."

export function optionLabel(group: string, value: string | null | undefined): string | null {
  if (!value) return null
  return OPTIONS[group]?.find((o) => o.value === value)?.label ?? value
}

export function presetText(key: string): string | null {
  return PRESET_RULES.find((r) => r.key === key)?.text ?? null
}
