import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Code2, Layers3, Sparkles, Wallet, Zap } from "lucide-react"

export const metadata: Metadata = {
  title: "Shipwright | Dock",
  description: "Turn an API service into a working CLI + MCP server.",
  openGraph: {
    title: "Shipwright | Dock",
    description: "Turn an API service into a working CLI + MCP server.",
    url: "/shipwright",
    siteName: "Dock",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shipwright | Dock",
    description: "Turn an API service into a working CLI + MCP server.",
  },
}

const capabilities = [
  {
    icon: Code2,
    title: "Generate a CLI",
    description: "Shipwright turns your API service into a usable Go command-line tool.",
  },
  {
    icon: Layers3,
    title: "Generate an MCP server",
    description: "Shipwright exposes the same service as agent-ready MCP tools.",
  },
  {
    icon: Wallet,
    title: "Add Buoy when needed",
    description: "Wrap the service with x402 payment gating when you want paid access.",
  },
  {
    icon: Zap,
    title: "Keep a local mirror",
    description: "Mirror API state in SQLite for fast, compact, token-efficient workflows.",
  },
]

const steps = [
  {
    title: "Connect your API service",
    body: "Point Shipwright at an OpenAPI spec or documented service and let it inspect the endpoints.",
  },
  {
    title: "Generate the working CLI + MCP server",
    body: "Shipwright ships a real repo with the command-line tool, MCP server, README, and install instructions.",
  },
  {
    title: "Ship it from GitHub",
    body: "Push the generated repo, link it from Shipyard, and use it in your agent workflow right away.",
  },
]

const benefits = [
  "Working CLI and MCP repo, not just a stub",
  "One command from API spec to usable tooling",
  "Built for agents and humans to use the same surface",
  "SQLite mirror for local state and recall",
  "Buoy-compatible when you want payment gating",
]

export default function ShipwrightPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 lg:px-6 lg:py-10">
      <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-300">
            <Sparkles size={12} />
            API → working CLI + MCP repo
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Turn an API service into a working CLI + MCP server
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-zinc-400">
              Shipwright detects your endpoints, generates the tooling, and ships a ready-to-use repo — so your API becomes something agents can actually call.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="#generate"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
            >
              Generate Your CLI
              <ArrowRight size={16} />
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-cyan-500/30 hover:text-cyan-200"
            >
              See How It Works
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {benefits.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-[#111118] p-4">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={18} />
                <p className="text-sm leading-6 text-zinc-300">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#111118] p-6 shadow-[0_0_30px_rgba(124,58,237,0.08)]">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">What Shipwright does</p>
              <p className="mt-2 text-sm text-zinc-300">A builder layer inside the main Shipyard site</p>
            </div>
            <div className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-300">
              Live under Shipyard
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {[
              "Inspect the API endpoints",
              "Generate a working CLI + MCP repo",
              "Include README and install instructions",
              "Push the repo to GitHub and ship it",
            ].map((line) => (
              <div key={line} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 text-sm text-zinc-300">
                <div className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                {line}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-black/30 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Example output</p>
            <pre className="mt-3 overflow-x-auto text-xs leading-6 text-zinc-300">
{`shipwright generate --spec ./openapi.yaml

✅ CLI created
✅ MCP server created
✅ README created
✅ Install instructions added
✅ GitHub repo ready to ship`}
            </pre>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">How it works</p>
            <h2 className="mt-2 text-2xl font-bold text-white">Three steps from API service to ship</h2>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">
            Back to Dock →
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-2xl border border-zinc-800 bg-[#111118] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-600">0{index + 1}</p>
              <h3 className="mt-3 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <div className="rounded-3xl border border-zinc-800 bg-[#111118] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Capabilities</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Built for real usage</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                <Icon className="text-violet-300" size={20} />
                <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
              </div>
            ))}
          </div>
        </div>

        <div id="generate" className="rounded-3xl border border-violet-500/20 bg-[linear-gradient(180deg,rgba(124,58,237,0.12),rgba(17,17,24,1))] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Why it matters</p>
          <h2 className="mt-2 text-2xl font-bold text-white">Less glue, more working software</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">
            Shipwright is not another wrapper layer. It takes a raw API service and ships a working CLI + MCP version of it — something agents and humans can both use immediately.
          </p>

          <ul className="mt-6 space-y-3">
            {[
              "Working repo, not a concept",
              "CLI and MCP generated from the same source",
              "Easy to ship, install, and link from Shipyard",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-zinc-200">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={18} />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-violet-400/30 hover:text-white"
            >
              Open Dock
            </Link>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              Explore the stack
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
