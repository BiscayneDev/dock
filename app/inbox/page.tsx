import type { Metadata } from "next"
import { InboxClient } from "@/components/inbox/InboxClient"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Inbox · Dock",
  description: "One queue of human decisions, each bound to an artifact version.",
}

export default function InboxPage() {
  return <InboxClient />
}
