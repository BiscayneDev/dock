import type { ReactNode } from "react"
import { DigitalWave } from "@/components/DigitalWave"

export function DockEntry({ children }: { children: ReactNode }) {
  return (
    <main className="dock-entry">
      <div className="dock-entry-inner">{children}</div>
      <DigitalWave className="dock-entry-wave" />
    </main>
  )
}
