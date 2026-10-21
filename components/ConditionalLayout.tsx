"use client"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/Sidebar"
import { ToastProvider } from "@/components/ToastProvider"
import { CommandPalette } from "@/components/CommandPalette"
import { VicPanel } from "@/components/vic/VicPanel"

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isSetup = pathname.startsWith("/setup")

  if (isSetup || pathname === "/login") {
    return <>{children}</>
  }

  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">{children}</main>
      </div>
      <CommandPalette />
      <ToastProvider />
      <VicPanel />
    </>
  )
}
