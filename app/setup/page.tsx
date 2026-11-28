import { redirect } from "next/navigation"

// The runtime chooser is retired: Dock is the harness, and runtimes are
// interchangeable backends configured in Settings → Devices. Deep links to
// /setup land in the real onboarding flow instead.
export default function SetupPage() {
  redirect("/onboarding")
}
