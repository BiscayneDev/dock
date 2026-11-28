"use client"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/Sidebar"
import { ToastProvider } from "@/components/ToastProvider"
import { CommandPalette } from "@/components/CommandPalette"

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isSetup = pathname.startsWith("/setup")
  const isLanding = pathname === "/"
  const isOnboarding = pathname === "/onboarding"

  if (isSetup || isLanding || isOnboarding || pathname === "/login") {
    return <>{children}</>
  }

  return (
    <>
      <div className="dock-workspace flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">{children}</main>
      </div>
      <CommandPalette />
      <ToastProvider />
    </>
  )
}
