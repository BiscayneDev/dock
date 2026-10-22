import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"
export interface RecommendedSkill {
  readonly name: string
  readonly category: string
  readonly description: string
  readonly recommended_for: readonly string[]
}

export const RECOMMENDED_SKILLS: readonly RecommendedSkill[] = [
  { name: "scrapling", category: "research", description: "Web scraping for agents", recommended_for: ["chief", "scout"] },
  { name: "last30days", category: "research", description: "Last 30 days intelligence", recommended_for: ["chief", "scout", "deal-flow"] },
  { name: "mooniq-check-wallet", category: "crypto", description: "Check wallet balances", recommended_for: ["baron"] },
  { name: "mooniq-buy-crypto", category: "crypto", description: "Buy cryptocurrency", recommended_for: ["baron"] },
  { name: "mooniq-sell-crypto", category: "crypto", description: "Sell cryptocurrency", recommended_for: ["baron"] },
  { name: "mooniq-swap-tokens", category: "crypto", description: "Swap tokens", recommended_for: ["baron"] },
  { name: "summarize", category: "research", description: "Text summarization", recommended_for: ["chief", "scout", "deal-flow"] },
  { name: "xurl", category: "communication", description: "URL/web utility", recommended_for: ["scout", "deal-flow"] },
  { name: "coding-agent", category: "engineering", description: "Code generation", recommended_for: ["builder"] },
  { name: "github", category: "engineering", description: "GitHub integration", recommended_for: ["builder", "chief"] },
  { name: "gh-issues", category: "engineering", description: "GitHub issues", recommended_for: ["builder", "chief"] },
] as const

export function getRecommendedSkillsForAgent(agentId: string): string[] {
  return RECOMMENDED_SKILLS
    .filter(s => s.recommended_for.includes(agentId === CHIEF_RUNTIME_KEY ? "chief" : agentId))
    .map(s => s.name)
}

export function isRecommended(skillName: string): boolean {
  return RECOMMENDED_SKILLS.some(s => s.name === skillName)
}

export function getRecommendedSkill(skillName: string): RecommendedSkill | undefined {
  return RECOMMENDED_SKILLS.find(s => s.name === skillName)
}
