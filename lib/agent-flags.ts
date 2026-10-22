import { readFile } from "fs/promises"
import { join } from "path"
import { templateAgentExplore } from "@/lib/agent-templates"

/**
 * Resolve an agent's explore (read-only) flag at run-enqueue time.
 *
 * Agents live at runtime in data/agents.json (seeded from TEAM_TEMPLATES with
 * the template's `explore` field spread in). Customized/unknown agents fall
 * back to the template defaults so a Scout-style agent stays read-only even
 * if its runtime record is missing the flag.
 */
export async function resolveAgentExplore(agentKey: string): Promise<boolean> {
  try {
    const raw = await readFile(join(process.cwd(), "data", "agents.json"), "utf-8")
    const agents = JSON.parse(raw) as { id?: string; explore?: boolean }[]
    const hit = Array.isArray(agents) ? agents.find((a) => a.id === agentKey) : undefined
    if (hit) return hit.explore === true
  } catch {
    // Missing/unreadable file: fall through to template defaults.
  }
  return templateAgentExplore(agentKey)
}
