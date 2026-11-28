import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { currentUser, sessionClient } from "@/lib/tenancy"
import { KnowledgeClient } from "@/components/knowledge/KnowledgeClient"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Knowledge · Dock",
  description: "Skills, domain knowledge and data-access guidance, maintained by flags, a curator and human approval.",
}

/**
 * /knowledge — the beacon surface. Skills, domain knowledge and data-access
 * guidance live here as portable OKF documents, kept current by a
 * flag → curator → approval loop rather than written once.
 */
export default async function KnowledgePage() {
  const user = await sessionClient().then((client) => currentUser(client)).catch(() => null)
  if (!user) redirect("/login")

  return <KnowledgeClient />
}
