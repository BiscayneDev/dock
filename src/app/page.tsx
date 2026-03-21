import Link from 'next/link'
import { NavBar } from '@/components/NavBar'

const CAPABILITIES = [
  { icon: '📧', title: 'Email', desc: 'Search, read, draft, send, and archive emails' },
  { icon: '📅', title: 'Calendar', desc: 'View, create, update events and find free time' },
  { icon: '🐙', title: 'GitHub', desc: 'Track repos, issues, PRs, and notifications' },
  { icon: '📝', title: 'Notion', desc: 'Search, read, create, and update pages' },
  { icon: '🔐', title: 'Wallet', desc: 'Check balances, send crypto, sign messages via OpenWallet' },
  { icon: '⏰', title: 'Reminders', desc: 'Set, list, and manage reminders' },
  { icon: '🤖', title: 'Recipes', desc: 'Automate workflows with triggers and schedules' },
]

export default function LandingPage() {
  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-zinc-100">
          Your AI first mate,
          <br />
          <span className="text-cyan-400">always on deck.</span>
        </h1>
        <p className="mt-6 text-lg text-zinc-400 max-w-xl mx-auto">
          Dock manages your email, calendar, code, and notes through natural conversation in Telegram.
          No app switching. No dashboard hopping. Just chat.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="https://t.me/heydeckhandbot"
            className="inline-flex items-center rounded-lg bg-cyan-600 px-6 py-3 text-lg font-medium text-white hover:bg-cyan-500 transition-colors"
          >
            Open in Telegram
          </Link>
          <Link
            href="/onboarding"
            className="inline-flex items-center rounded-lg border border-zinc-700 px-6 py-3 text-lg font-medium text-zinc-300 hover:border-zinc-500 transition-colors"
          >
            Set up integrations
          </Link>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 text-left"
            >
              <span className="text-2xl">{cap.icon}</span>
              <h3 className="mt-2 font-semibold text-zinc-100">{cap.title}</h3>
              <p className="mt-1 text-sm text-zinc-400">{cap.desc}</p>
            </div>
          ))}
        </div>

        <footer className="mt-20 border-t border-zinc-800 pt-8 text-sm text-zinc-500">
          Dock — AI-powered productivity through Telegram
        </footer>
      </main>
    </div>
  )
}
