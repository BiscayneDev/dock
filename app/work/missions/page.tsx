import type { Metadata } from "next"
import WorkClient from "../WorkClient"

export const metadata: Metadata = {
  title: "Missions | Dock",
}

/** Missions board as a section of the Work surface. */
export default function MissionsSection() {
  return <WorkClient />
}
