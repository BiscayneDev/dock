import Link from 'next/link'

interface NavBarProps {
  showDashboard?: boolean
}

export function NavBar({ showDashboard = false }: NavBarProps) {
  return (
    <nav className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-cyan-400">
          ⚓ Dock
        </Link>
        <div className="flex items-center gap-4">
          {showDashboard && (
            <>
              <Link
                href="/dashboard"
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Settings
              </Link>
              <Link
                href="/dashboard/recipes"
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Recipes
              </Link>
              <Link
                href="/dashboard/integrations"
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                MCP Servers
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
