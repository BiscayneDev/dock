// Injectable skill descriptions for prompt injection (server only). Reads the SKILL.md
// import store written by /api/skills/import. Empty on any read/parse failure: skill
// injection is an enhancement, never a run blocker.
import { readFile } from "fs/promises"
import { join } from "path"

export interface InjectableSkill {
  name: string
  description: string
  tags: string[]
}

export async function loadInjectableSkills(cwd: string = process.cwd()): Promise<InjectableSkill[]> {
  try {
    const raw = JSON.parse(await readFile(join(cwd, "data", "external-skills.json"), "utf-8"))
    if (!Array.isArray(raw)) return []
    return raw
      .filter((s: Record<string, unknown>) => typeof s?.name === "string" && typeof s?.description === "string")
      .map((s: Record<string, unknown>) => ({
        name: s.name as string,
        description: s.description as string,
        tags: Array.isArray(s.tags) ? (s.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
      }))
  } catch {
    return []
  }
}
