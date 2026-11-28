import type { ReactNode } from "react"

export function DockEntry({ children }: { children: ReactNode }) {
  return (
    <main className="dock-entry">
      <div className="dock-entry-inner">{children}</div>
      <div className="dock-entry-wave" aria-hidden="true" />
    </main>
  )
}
