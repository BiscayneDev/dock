import { redirect } from "next/navigation"
import { currentUser, sessionClient } from "@/lib/tenancy"
import WorkClient from "./WorkClient"

/**
 * /work — the exec-brief surface. The Command Deck content (today's brief, fleet,
 * decisions, portfolio) lives here as the top of Work; the board, runs, intel,
 * calendar and projects are one click down via the rail below.
 */
export default async function WorkPage() {
  const setupDone = await isSetupComplete()
  if (!setupDone) redirect("/setup")

  const user = await sessionClient().then((c) => currentUser(c)).catch(() => null)
  if (!user) redirect("/login")

  return <WorkClient />
}

async function isSetupComplete(): Promise<boolean> {
  try {
    const { readFile } = await import("fs/promises")
    const { join } = await import("path")
    const raw = await readFile(join(process.cwd(), "data", "setup.json"), "utf-8")
    return (JSON.parse(raw) as { completed?: boolean }).completed === true
  } catch {
    return false
  }
}
