import { redirect } from "next/navigation"

/**
 * /dashboard → /work. The Command Deck content now lives at the top of the Work
 * surface; the old route stays live for bookmarks and deep links.
 */
export default function LegacyDashboard() {
  redirect("/work")
}
