import { redirect } from "next/navigation"
import { currentUser, sessionClient } from "@/lib/tenancy"
import WorkClient from "./WorkClient"

/**
 * /work — the exec-brief surface. The Command Deck content (today's brief, fleet,
 * decisions, portfolio) lives here as the top of Work; the board, runs, intel,
 * calendar and projects are one click down via the rail below.
 */
export default async function WorkPage() {
  const user = await sessionClient().then((c) => currentUser(c)).catch(() => null)
  if (!user) redirect("/login")

  return <WorkClient />
}
