import { NextResponse } from "next/server"
import { readFile, readdir, writeFile, mkdir } from "fs/promises"
import { join, resolve } from "path"
import { existsSync } from "fs"
import { parseSkillMd, findSkillMdPaths } from "@/lib/skills-skillmd"

// POST /api/skills/import { dir?: string }
// Reads SKILL.md files from a skills directory (default: <cwd>/skills),
// parses each with parseSkillMd, and upserts into data/external-skills.json
// with source: "skillmd". Mirrors sibling skills routes (no session gate).
const MAX_FILES = 200
const EXTERNAL_SKILLS_PATH = join(process.cwd(), "data", "external-skills.json")

type ExternalSkill = {
  name: string
  description: string
  category: string
  tags: string[]
  source_url?: string
  added_at: string
  source?: string
}

async function readExternalSkills(): Promise<ExternalSkill[]> {
  try {
    return JSON.parse(await readFile(EXTERNAL_SKILLS_PATH, "utf-8"))
  } catch {
    return []
  }
}

async function writeExternalSkills(skills: ExternalSkill[]): Promise<void> {
  await mkdir(join(process.cwd(), "data"), { recursive: true })
  await writeFile(EXTERNAL_SKILLS_PATH, JSON.stringify(skills, null, 2), "utf-8")
}

export async function POST(req: Request) {
  let dir: string
  try {
    const body = (await req.json().catch(() => ({}))) as { dir?: string }
    dir = resolve(process.cwd(), body.dir && body.dir.trim() ? body.dir.trim() : "skills")
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request body" }, { status: 400 })
  }

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return NextResponse.json(
      { ok: false, error: `directory not readable: ${dir}` },
      { status: 400 }
    )
  }

  const candidates = findSkillMdPaths(entries).filter((rel) => existsSync(join(dir, rel)))
  const truncated = candidates.length > MAX_FILES
  const limited = candidates.slice(0, MAX_FILES)

  const errors: Array<{ path: string; message: string }> = []
  if (truncated) {
    errors.push({
      path: dir,
      message: `skipped ${candidates.length - MAX_FILES} files: only the first ${MAX_FILES} are imported`,
    })
  }

  const imported: ExternalSkill[] = []
  for (const rel of limited) {
    const path = join(dir, rel)
    try {
      const text = await readFile(path, "utf-8")
      const parsed = parseSkillMd(text, rel)
      imported.push({
        name: parsed.name,
        description: parsed.description,
        category: "other",
        tags: parsed.tags,
        added_at: new Date().toISOString(),
        source: "skillmd",
      })
    } catch (err) {
      errors.push({ path: rel, message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Upsert by name into the existing external-skills store.
  const existing = await readExternalSkills()
  const byName = new Map(existing.map((s) => [s.name, s]))
  for (const skill of imported) byName.set(skill.name, skill)
  await writeExternalSkills([...byName.values()])

  return NextResponse.json({
    ok: true,
    imported: imported.length,
    total: byName.size,
    errors,
  })
}
