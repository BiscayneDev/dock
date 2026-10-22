import { NextResponse } from "next/server"
import { readFile, writeFile, mkdir, readdir } from "fs/promises"
import { join, dirname } from "path"
import { existsSync } from "fs"
import { homedir } from "os"
import { CHIEF_RUNTIME_KEY } from "@/lib/chief-key"

const ASSIGNMENTS_PATH = join(process.cwd(), "data", "agents-skills.json")

const CATEGORY_MAP: Record<string, string> = {
  "last30days": "research", "summarize": "research", "scrapling": "research",
  "blogwatcher": "research", "xurl": "communication",
  "coding-agent": "engineering", "github": "engineering", "gh-issues": "engineering",
  "skill-creator": "engineering",
  "mooniq-check-wallet": "crypto", "mooniq-buy-crypto": "crypto",
  "mooniq-sell-crypto": "crypto", "mooniq-swap-tokens": "crypto",
  "mooniq-discover-tokens": "crypto", "mooniq-lending": "crypto",
  "mooniq-limit-orders": "crypto", "mooniq-recurring-orders": "crypto",
  "mooniq-onramp-offramp": "crypto", "mooniq-auth": "crypto",
  "gog": "communication", "imsg": "communication", "wacli": "communication",
  "discord": "communication", "slack": "communication",
  "weather": "productivity", "healthcheck": "productivity", "clawhub": "productivity",
  "model-usage": "productivity", "auto-updater": "productivity",
  "ontology": "productivity", "peekaboo": "productivity", "canvas": "productivity",
  "gemini": "ai", "sag": "ai", "openai-whisper": "ai", "openai-whisper-api": "ai",
  "openai-image-gen": "ai", "nano-banana-pro": "ai", "nano-pdf": "ai",
}

function getCategory(name: string): string {
  return CATEGORY_MAP[name] ?? "other"
}

async function parseFrontmatter(filePath: string): Promise<{ name: string; description: string } | null> {
  try {
    const content = await readFile(filePath, "utf-8")
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    const fm = match[1]
    const nameMatch = fm.match(/^name:\s*(.+)$/m)
    const descMatch = fm.match(/^description:\s*["']?(.+?)["']?$/m)
    if (!nameMatch) return null
    return {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim().replace(/^['"]|['"]$/g, "") : "",
    }
  } catch { return null }
}

async function getDisabledSkills(): Promise<Set<string>> {
  try {
    const cfgPath = join(homedir(), ".openclaw", "openclaw.json")
    const cfg = JSON.parse(await readFile(cfgPath, "utf-8"))
    const entries = cfg?.skills?.entries ?? {}
    return new Set(Object.entries(entries).filter(([, v]: [string, unknown]) => (v as Record<string, unknown>)?.enabled === false).map(([k]) => k))
  } catch { return new Set() }
}

async function buildCatalog() {
  const disabled = await getDisabledSkills()
  const dirs = [
    join("/opt/homebrew/lib/node_modules/openclaw/skills"),
    join(homedir(), "clawd", "skills"),
  ]
  const skills: Array<{ name: string; description: string; category: string }> = []
  const seen = new Set<string>()

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const entries = await readdir(dir)
    for (const entry of entries) {
      const skillMd = join(dir, entry, "SKILL.md")
      if (!existsSync(skillMd)) continue
      const parsed = await parseFrontmatter(skillMd)
      if (!parsed || seen.has(parsed.name)) continue
      if (disabled.has(parsed.name)) continue
      seen.add(parsed.name)
      skills.push({ name: parsed.name, description: parsed.description, category: getCategory(parsed.name) })
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function readAssignments(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await readFile(ASSIGNMENTS_PATH, "utf-8"))
  } catch {
    return { [CHIEF_RUNTIME_KEY]: [], scout: [], builder: [], baron: [], "deal-flow": [] }
  }
}

export async function GET() {
  const [assignments, catalog] = await Promise.all([readAssignments(), buildCatalog()])
  return NextResponse.json({ assignments, catalog })
}

export async function POST(req: Request) {
  try {
    const { assignments } = await req.json() as { assignments: Record<string, string[]> }
    await mkdir(dirname(ASSIGNMENTS_PATH), { recursive: true })
    await writeFile(ASSIGNMENTS_PATH, JSON.stringify(assignments, null, 2), "utf-8")
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
