import { inferenceChat } from "@/lib/inference"
import { CHIEF_RUNTIME_AGENT } from "@/lib/tenancy"
import { buildChiefPrompt, describeAnswer, type ProfileView, type RuleView } from "@/lib/onboarding-server"

// The Chief's opening message for a new venture. Written only from the saved answers.

export interface VentureSummary {
  name: string
  profile: ProfileView | null
  rules: RuleView[]
}

const MAX_CHARS = 1200

/** Deterministic text from the same saved answers, used when no model is configured or the call fails. */
export function fallbackIntro(v: VentureSummary): string {
  const p = v.profile
  // A skipped or empty answer reads as a decision the Chief will make, never as a made-up value.
  const get = (group: string, a: ProfileView["stage"] | undefined): string | null => {
    if (!a || a.skipped || !a.choice) return null
    return describeAnswer(group, a) || null
  }
  const goal = p?.goal?.trim() || null
  const stage = get("stage", p?.stage)
  const direction = get("direction", p?.direction)
  const customer = get("customer", p?.customer)
  const pricing = get("pricing", p?.pricing)
  const acquisition = get("acquisition", p?.acquisition)
  const activeRules = v.rules.filter((r) => r.enabled).length

  const sentences = [
    `I'm your Chief of Staff for ${v.name}.`,
    goal ? `The goal is: ${goal}.` : "The goal is not set, so I'll decide it with you.",
    `Stage: ${stage ?? "I'll decide it"}. Direction: ${direction ?? "I'll decide it"}.`,
    `First customer: ${customer ?? "I'll decide it"}. Pricing: ${pricing ?? "I'll decide it"}.`,
    `Acquisition: ${acquisition ?? "I'll decide it"}.`,
    activeRules > 0
      ? `${activeRules} rule${activeRules === 1 ? " is" : "s are"} active for this project. Tell me where you want to start.`
      : "No project rules are set yet. Tell me where you want to start.",
  ]
  return sentences.join(" ")
}

/** Writes the opening message with the chat model. Falls back to fallbackIntro on any failure. */
export async function ventureIntro(v: VentureSummary): Promise<string> {
  const block = buildChiefPrompt(null, [], { name: v.name, profile: v.profile, rules: v.rules })
  const system = [
    block ?? `Current project: ${v.name}`,
    "",
    "Write the opening message for this project's chat, from the Chief of Staff.",
    "Rules for the message:",
    "- 4 to 6 sentences, plain text, no headings or lists.",
    "- Use only the facts listed above. Do not invent metrics, dates, customers, prices or results.",
    "- For any item listed as 'not set', say that you will decide it.",
    "- End by asking what the user wants to work on first.",
  ].join("\n")
  try {
    const text = await inferenceChat({
      message: "Write the opening message now.",
      agent: CHIEF_RUNTIME_AGENT,
      system,
    })
    const clean = text?.trim()
    if (clean) return clean.slice(0, MAX_CHARS)
  } catch {
    // fall through to the deterministic text
  }
  return fallbackIntro(v)
}
