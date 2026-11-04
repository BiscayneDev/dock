import { NextResponse } from "next/server"
import { assistantContext } from "@/lib/assistant-store"
import { listRegisteredRepos, registerRepo } from "@/lib/isolation/registered-repos"

export const dynamic = "force-dynamic"

/**
 * Registered repos: the owner-managed allowlist of repositories that isolated
 * task runs may use. Owner session only - the agent token can USE a registered
 * repo but cannot register one, so a token cannot point Dock at an arbitrary
 * host path.
 */
export async function GET() {
  if (!(await assistantContext())) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  return NextResponse.json({ repos: await listRegisteredRepos() })
}

export async function POST(request: Request) {
  if (!(await assistantContext())) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { path?: unknown }
  if (typeof body.path !== "string" || !body.path.trim()) {
    return NextResponse.json({ error: "path required" }, { status: 400 })
  }
  try {
    const resolved = await registerRepo(body.path.trim())
    return NextResponse.json({ ok: true, path: resolved })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not register repo" },
      { status: 400 },
    )
  }
}
